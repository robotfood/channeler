import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  encoderForBackend,
  mpegtsArgs,
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
const backendProbeCache = new Map<Backend, string>()

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
    'stable_mpegts',
    'transcode_720p',
    'transcode_1080p',
    'repair_1080p',
    'smooth_720p60',
  ]

  return hasArg('--all') ? [...base, 'smooth_1080p60'] : base
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

function probeArgsForBackend(backend: Exclude<Backend, 'cpu'>) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    ...(backend === 'vaapi' ? vaapiDeviceArgs() : []),
    ...(backend === 'qsv' ? qsvDeviceArgs() : []),
    '-f', 'lavfi',
    '-i', backend === 'qsv' || backend === 'vaapi' ? 'testsrc2=size=1280x720:rate=30' : 'testsrc2=size=640x360:rate=30',
    '-frames:v', '10',
    '-vf', backend === 'vaapi' ? 'format=nv12,hwupload' : backend === 'videotoolbox' ? 'format=yuv420p' : 'format=nv12',
    '-an',
    '-c:v', encoderForBackend(backend),
    ...(backend === 'qsv' ? ['-preset', 'veryfast', '-b:v', '3000k', '-maxrate', '4000k', '-bufsize', '6000k'] : []),
    ...(backend === 'amf' ? ['-quality', 'speed'] : []),
    ...(backend === 'vaapi' ? ['-qp', '23'] : []),
    '-f', 'null',
    '-',
  ]
}

function backendProbeResult(backend: Backend) {
  if (backend === 'cpu') return 'ok'
  const cached = backendProbeCache.get(backend)
  if (cached) return cached

  const result = spawnSync(FFMPEG, probeArgsForBackend(backend), {
    encoding: 'utf8',
    timeout: 15000,
  })
  const detail = result.status === 0
    ? 'ok'
    : (result.stderr || result.stdout || result.error?.message || `${backend} probe failed`).trim().slice(-600)
  backendProbeCache.set(backend, detail)
  return detail
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
    throw new Error(`Unable to create stable_mpegts input: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return inputPath
}

function inputArgs(profile: string, stableInput: string) {
  if (profile === 'stable_mpegts') return ['-i', stableInput]
  return [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', String(DURATION_SECONDS),
  ]
}

function profileBackends(profile: string, backends: Backend[]) {
  if (profile === 'stable_mpegts') return ['cpu'] as Backend[]
  return backends
}

function validateMpegts(output: Buffer) {
  if (output.length < 188 * 10) return `too little MPEG-TS output: ${output.length} bytes`

  let bestOffset = -1
  let bestMatches = 0
  for (let offset = 0; offset < 188; offset += 1) {
    let matches = 0
    for (let pos = offset; pos < output.length; pos += 188) {
      if (output[pos] === 0x47) matches += 1
    }
    if (matches > bestMatches) {
      bestMatches = matches
      bestOffset = offset
    }
  }

  const expectedPackets = Math.floor((output.length - Math.max(bestOffset, 0)) / 188)
  if (bestOffset < 0 || bestMatches < Math.max(8, expectedPackets * 0.8)) {
    return `MPEG-TS sync byte cadence not found (${bestMatches}/${expectedPackets} packets)`
  }
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
  const backendProbe = backendProbeResult(backend)
  if (backendProbe !== 'ok') {
    return {
      profile,
      backend,
      status: 'skip',
      elapsedMs: 0,
      detail: backendProbe,
    }
  }

  const startedAt = Date.now()
  const result = spawnSync(FFMPEG, [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    ...(backend === 'vaapi' ? vaapiDeviceArgs() : []),
    ...(backend === 'qsv' ? qsvDeviceArgs() : []),
    ...inputArgs(profile, stableInput),
    ...profileArgs(profile, backend, {
      audioInputIndex: profile === 'stable_mpegts' ? 0 : 1,
      audioProfile: AUDIO_PROFILE,
      unknownProfile: 'throw',
    }),
    ...mpegtsArgs(),
  ], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
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
      detail: (result.stderr?.toString() || result.stdout?.toString() || `FFmpeg exited ${result.status}`).trim().slice(-600),
    }
  }

  const mpegtsStatus = validateMpegts(result.stdout)
  return {
    profile,
    backend,
    status: mpegtsStatus === 'ok' ? 'pass' : 'fail',
    elapsedMs,
    detail: mpegtsStatus,
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
