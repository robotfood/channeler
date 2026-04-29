import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  encoderForBackend,
  hlsArgs,
  profileArgs,
  qsvDeviceArgs as qsvDeviceArgsForDevice,
  TRANSCODE_BACKENDS,
  type TranscodeBackend,
  vaapiDeviceArgs as vaapiDeviceArgsForDevice,
} from '../lib/ffmpeg-transcode-args'
import { normalizePlaybackProfile } from '../lib/playback-profile'
import { normalizeAudioProfile } from '../lib/audio-profile'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const DURATION_SECONDS = parseFloat(process.env.TRANSCODE_TEST_DURATION || '5')
const TEST_TIMEOUT_MS = parseInt(process.env.TRANSCODE_TEST_TIMEOUT_MS || '90000', 10)
const BACKENDS = TRANSCODE_BACKENDS
const AUDIO_PROFILE = normalizeAudioProfile(optionValue('--audio-profile') || process.env.TRANSCODE_TEST_AUDIO_PROFILE)

type Backend = TranscodeBackend
type Result = {
  profile: string
  backend: string
  status: 'pass' | 'fail' | 'skip'
  elapsedMs: number
  detail: string
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function optionValue(name: string) {
  const prefix = `${name}=`
  const match = process.argv.find(arg => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

function selectedBackends(): Backend[] {
  const raw = optionValue('--backends') || process.env.TRANSCODE_TEST_BACKENDS
  if (!raw) return [...BACKENDS]

  const values = raw.split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  return values.filter((value): value is Backend => BACKENDS.includes(value as Backend))
}

function selectedProfiles() {
  const raw = optionValue('--profiles') || process.env.TRANSCODE_TEST_PROFILES
  if (raw) {
    return raw.split(',').map(value => {
      const normalized = normalizePlaybackProfile(value.trim())
      if (normalized === 'direct' || normalized === 'proxy') throw new Error(`Unknown transcode profile: ${value.trim()}`)
      return normalized
    }).filter(Boolean)
  }

  const base = [
    'stable_hls',
    'transcode_720p',
    'transcode_1080p',
    'enhanced_1080p',
    'clean_1080p',
    'smooth_720p60',
    'sports_720p60',
  ]

  return hasArg('--all') ? [...base, 'transcode_4k', 'smooth_1080p60'] : base
}

function qsvDevicePath() {
  const configured = process.env.TRANSCODE_RENDER_DEVICE?.trim() || process.env.TRANSCODE_QSV_DEVICE?.trim()
  if (configured) return configured

  const defaultDevice = '/dev/dri/renderD128'
  return fs.existsSync(defaultDevice) ? defaultDevice : null
}

function vaapiDeviceArgs() {
  return vaapiDeviceArgsForDevice(qsvDevicePath())
}

function qsvDeviceArgs() {
  return qsvDeviceArgsForDevice(qsvDevicePath())
}

function ffmpegEncoders() {
  try {
    return execFileSync(FFMPEG, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      timeout: 5000,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Unable to run ${FFMPEG} -encoders: ${message}`)
  }
}

function createStableInput(tempDir: string) {
  const inputPath = path.join(tempDir, 'input.ts')
  const result = spawnSync(FFMPEG, [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', String(DURATION_SECONDS),
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-f', 'mpegts',
    inputPath,
  ], {
    encoding: 'utf8',
    timeout: TEST_TIMEOUT_MS,
  })

  if (result.status !== 0) {
    throw new Error(`Unable to create stable_hls input: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return inputPath
}

function inputArgs(profile: string, stableInput: string) {
  if (profile === 'stable_hls') return ['-i', stableInput]
  return [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', String(DURATION_SECONDS),
  ]
}

function profileBackends(profile: string, backends: Backend[]) {
  if (profile === 'stable_hls') return ['cpu'] as Backend[]
  return backends
}

function validateHls(outputDir: string) {
  const indexPath = path.join(outputDir, 'index.m3u8')
  if (!fs.existsSync(indexPath)) return 'missing index.m3u8'

  const index = fs.readFileSync(indexPath, 'utf8')
  if (!index.includes('#EXTM3U') || !index.includes('#EXTINF')) return 'index.m3u8 is not a populated HLS playlist'

  const segments = fs.readdirSync(outputDir).filter(file => file.endsWith('.ts'))
  if (segments.length === 0) return 'no .ts segments were created'
  return 'ok'
}

function runProfile(profile: string, backend: Backend, root: string, stableInput: string, encoders: string): Result {
  const encoder = encoderForBackend(backend)
  if (backend !== 'cpu' && !encoders.includes(encoder)) {
    return {
      profile,
      backend,
      status: 'skip',
      elapsedMs: 0,
      detail: `${encoder} is not compiled into this FFmpeg`,
    }
  }

  const outputDir = path.join(root, `${profile}-${backend}`)
  fs.mkdirSync(outputDir, { recursive: true })

  const startedAt = Date.now()
  const result = spawnSync(FFMPEG, [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    ...(backend === 'vaapi' ? vaapiDeviceArgs() : []),
    ...(backend === 'qsv' ? qsvDeviceArgs() : []),
    ...inputArgs(profile, stableInput),
    ...profileArgs(profile, backend, {
      audioInputIndex: profile === 'stable_hls' ? 0 : 1,
      audioProfile: AUDIO_PROFILE,
      unknownProfile: 'throw',
    }),
    ...hlsArgs(outputDir),
  ], {
    encoding: 'utf8',
    timeout: TEST_TIMEOUT_MS,
  })
  const elapsedMs = Date.now() - startedAt

  if (result.error) {
    return {
      profile,
      backend,
      status: 'fail',
      elapsedMs,
      detail: result.error.message,
    }
  }

  if (result.status !== 0) {
    return {
      profile,
      backend,
      status: 'fail',
      elapsedMs,
      detail: (result.stderr || result.stdout || `FFmpeg exited ${result.status}`).trim().slice(-600),
    }
  }

  const hlsStatus = validateHls(outputDir)
  return {
    profile,
    backend,
    status: hlsStatus === 'ok' ? 'pass' : 'fail',
    elapsedMs,
    detail: hlsStatus,
  }
}

function printResults(results: Result[]) {
  const rows = results.map(result => ({
    Profile: result.profile,
    Backend: result.backend,
    Status: result.status.toUpperCase(),
    Time: result.elapsedMs ? `${(result.elapsedMs / 1000).toFixed(1)}s` : '-',
    Detail: result.detail,
  }))
  console.table(rows)

  const passed = results.filter(result => result.status === 'pass').length
  const skipped = results.filter(result => result.status === 'skip').length
  const failed = results.filter(result => result.status === 'fail').length
  console.log(`Transcode profile smoke test: ${passed} passed, ${skipped} skipped, ${failed} failed`)
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channeler-transcode-test-'))
  const keepOutput = hasArg('--keep-output')
  const profiles = selectedProfiles()
  const backends = selectedBackends()

  console.log(`FFmpeg: ${FFMPEG}`)
  console.log(`Temp output: ${tempDir}`)
  console.log(`Profiles: ${profiles.join(', ')}`)
  console.log(`Hardware backends: ${backends.join(', ')}`)
  console.log(`Audio profile: ${AUDIO_PROFILE}`)

  try {
    const encoders = ffmpegEncoders()
    const stableInput = createStableInput(tempDir)
    const results = profiles.flatMap(profile =>
      profileBackends(profile, backends).map(backend => runProfile(profile, backend, tempDir, stableInput, encoders))
    )

    printResults(results)
    if (results.some(result => result.status === 'fail')) process.exitCode = 1
  } finally {
    if (!keepOutput) fs.rmSync(tempDir, { recursive: true, force: true })
    else console.log(`Kept output at: ${tempDir}`)
  }
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
}
