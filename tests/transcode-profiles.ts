import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const DURATION_SECONDS = parseFloat(process.env.TRANSCODE_TEST_DURATION || '5')
const TEST_TIMEOUT_MS = parseInt(process.env.TRANSCODE_TEST_TIMEOUT_MS || '90000', 10)
const BACKENDS = ['vaapi', 'qsv', 'amf', 'videotoolbox', 'cpu'] as const

type Backend = typeof BACKENDS[number]
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
  if (raw) return raw.split(',').map(value => value.trim()).filter(Boolean)

  const base = [
    'stable_hls',
    'transcode_720p',
    'transcode_1080p',
    'enhanced_1080p',
    'clean_1080p',
    'sharp_1080p',
    'smooth_720p60',
    'sports_720p60',
  ]

  return hasArg('--all') ? [...base, 'transcode_4k', 'transcode_4k_ultra', 'smooth_1080p60'] : base
}

function encoderForBackend(backend: Backend) {
  switch (backend) {
    case 'vaapi':
      return 'h264_vaapi'
    case 'qsv':
      return 'h264_qsv'
    case 'amf':
      return 'h264_amf'
    case 'videotoolbox':
      return 'h264_videotoolbox'
    case 'cpu':
      return 'libx264'
  }
}

function qsvDevicePath() {
  const configured = process.env.TRANSCODE_RENDER_DEVICE?.trim() || process.env.TRANSCODE_QSV_DEVICE?.trim()
  if (configured) return configured

  const defaultDevice = '/dev/dri/renderD128'
  return fs.existsSync(defaultDevice) ? defaultDevice : null
}

function vaapiDeviceArgs() {
  const device = qsvDevicePath()
  return device ? ['-vaapi_device', device] : []
}

function qsvDeviceArgs() {
  const device = qsvDevicePath()
  if (!device) return []

  if (process.platform === 'linux') {
    return [
      '-init_hw_device', `vaapi=va:${device}`,
      '-init_hw_device', 'qsv=qsv@va',
      '-filter_hw_device', 'qsv',
    ]
  }

  return ['-init_hw_device', `qsv=qsv:${device}`, '-filter_hw_device', 'qsv']
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

function cpuH264Args(height: number, videoBitrate: string, maxrate: string, bufsize: string, audioBitrate: string) {
  return [
    '-map', '0:v:0?', '-map', '1:a:0?',
    '-vf', `scale=-2:'max(ih\\,${height})':flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-sc_threshold', '0',
    '-b:v', videoBitrate,
    '-maxrate', maxrate,
    '-bufsize', bufsize,
    '-c:a', 'aac',
    '-ac', '6',
    '-b:a', audioBitrate,
    '-ar', '48000',
    '-af', 'dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1:level_in=1:level_out=1:lfe_low=120',
  ]
}

function hardwareH264Args(backend: Backend, height: number, videoBitrate: string, maxrate: string, bufsize: string, audioBitrate: string) {
  const audioArgs = [
    '-c:a', 'aac',
    '-ac', '6',
    '-b:a', audioBitrate,
    '-ar', '48000',
    '-af', 'dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1:level_in=1:level_out=1:lfe_low=120',
  ]

  if (backend === 'cpu') return cpuH264Args(height, videoBitrate, maxrate, bufsize, audioBitrate)

  if (backend === 'vaapi') {
    return [
      '-map', '0:v:0?', '-map', '1:a:0?',
      '-vf', `scale=-2:'max(ih\\,${height})':flags=lanczos,format=nv12,hwupload`,
      '-c:v', encoderForBackend(backend),
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-qp', height >= 2160 ? '18' : height >= 1080 ? '21' : '23',
      ...audioArgs,
    ]
  }

  if (backend === 'videotoolbox') {
    return [
      '-map', '0:v:0?', '-map', '1:a:0?',
      '-vf', `scale=-2:'max(ih\\,${height})':flags=lanczos,format=yuv420p`,
      '-c:v', encoderForBackend(backend),
      '-realtime', 'true',
      '-prio_speed', '1',
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-b:v', videoBitrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      ...audioArgs,
    ]
  }

  return [
    '-map', '0:v:0?', '-map', '1:a:0?',
    '-vf', `scale=-2:'max(ih\\,${height})':flags=lanczos,format=nv12`,
    '-c:v', encoderForBackend(backend),
    ...(backend === 'qsv' ? ['-preset', 'veryfast'] : ['-quality', 'speed']),
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-b:v', videoBitrate,
    '-maxrate', maxrate,
    '-bufsize', bufsize,
    ...audioArgs,
  ]
}

function hardwareFilteredH264Args(backend: Backend, filter: string, videoBitrate: string, maxrate: string, bufsize: string, audioBitrate: string, fps?: number) {
  const audioArgs = [
    '-c:a', 'aac',
    '-ac', '6',
    '-b:a', audioBitrate,
    '-ar', '48000',
    '-af', 'dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1:level_in=1:level_out=1:lfe_low=120',
  ]

  const fpsArgs = fps ? [
    '-r', String(fps),
    '-g', String(fps * 2),
    '-keyint_min', String(fps * 2),
  ] : []

  if (backend === 'cpu') {
    return [
      '-map', '0:v:0?', '-map', '1:a:0?',
      '-vf', `${filter},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      ...fpsArgs,
      '-sc_threshold', '0',
      '-b:v', videoBitrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      ...audioArgs,
    ]
  }

  if (backend === 'vaapi') {
    return [
      '-map', '0:v:0?', '-map', '1:a:0?',
      '-vf', `${filter},format=nv12,hwupload`,
      '-c:v', encoderForBackend(backend),
      ...fpsArgs,
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-qp', '23',
      ...audioArgs,
    ]
  }

  return [
    '-map', '0:v:0?', '-map', '1:a:0?',
    '-vf', `${filter},format=${backend === 'videotoolbox' ? 'yuv420p' : 'nv12'}`,
    '-c:v', encoderForBackend(backend),
    ...(backend === 'qsv' ? ['-preset', 'veryfast'] : backend === 'amf' ? ['-quality', 'speed'] : []),
    ...fpsArgs,
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-b:v', videoBitrate,
    '-maxrate', maxrate,
    '-bufsize', bufsize,
    ...audioArgs,
  ]
}

function profileArgs(profile: string, backend: Backend) {
  switch (profile) {
    case 'stable_hls':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '6',
        '-b:a', '384k',
        '-ar', '48000',
        '-af', 'dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1:level_in=1:level_out=1:lfe_low=120',
      ]
    case 'transcode_720p':
      return hardwareH264Args(backend, 720, '3500k', '4200k', '7000k', '384k')
    case 'transcode_1080p':
      return hardwareH264Args(backend, 1080, '6000k', '7200k', '12000k', '512k')
    case 'transcode_4k':
      return hardwareH264Args(backend, 2160, '22000k', '28000k', '44000k', '640k')
    case 'transcode_4k_fast':
      return hardwareH264Args(backend, 2160, '20000k', '26000k', '40000k', '640k')
    case 'transcode_4k_ultra':
      return hardwareFilteredH264Args(
        backend,
        'scale=-2:2160:flags=lanczos,unsharp=3:3:0.5:3:3:0.5',
        '25000k', '32000k', '50000k', '640k'
      )
    case 'enhanced_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=0:parity=auto:deint=interlaced,scale=-2:\'max(ih\\,1080)\':flags=lanczos,unsharp=5:5:0.45:3:3:0.25',
        '6500k', '8000k', '13000k', '512k',
        30
      )
    case 'clean_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=0:parity=auto:deint=interlaced,hqdn3d=1.5:1.5:4:4,scale=-2:\'max(ih\\,1080)\':flags=lanczos,unsharp=3:3:0.25:3:3:0.12',
        '6000k', '7500k', '12000k', '512k',
        30
      )
    case 'sharp_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=0:parity=auto:deint=interlaced,scale=-2:\'max(ih\\,1080)\':flags=lanczos,unsharp=7:7:0.65:5:5:0.35',
        '6500k', '8500k', '13000k', '512k',
        30
      )
    case 'smooth_720p60':
      return hardwareFilteredH264Args(
        backend,
        'scale=-2:720:flags=lanczos,minterpolate=fps=60:mi_mode=blend',
        '5000k', '6500k', '10000k', '384k',
        60
      )
    case 'smooth_1080p60':
      return hardwareFilteredH264Args(
        backend,
        'scale=-2:1080:flags=lanczos,minterpolate=fps=60:mi_mode=blend',
        '8500k', '10000k', '17000k', '512k',
        60
      )
    case 'sports_720p60':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:720:flags=lanczos,unsharp=5:5:0.35:3:3:0.2',
        '5500k', '7000k', '11000k', '384k',
        60
      )
    default:
      throw new Error(`Unknown profile: ${profile}`)
  }
}

function hlsArgs(outputDir: string) {
  return [
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_init_time', '1',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+program_date_time+independent_segments',
    '-hls_segment_filename', path.join(outputDir, 'segment_%06d.ts'),
    path.join(outputDir, 'index.m3u8'),
  ]
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
    ...profileArgs(profile, backend),
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
