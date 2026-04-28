import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataPath } from '@/lib/data-path'
import { normalizePlaybackProfile, type PlaybackProfile } from '@/lib/playback-profile'
import type { channels, playlists } from '@/lib/schema'

type Channel = typeof channels.$inferSelect
type Playlist = typeof playlists.$inferSelect

type Session = {
  key: string
  channelId: number
  profile: PlaybackProfile
  backend: Exclude<HardwareBackend, 'auto'>
  sourceUrl: string
  outputDir: string
  playlistPath: string
  process: ChildProcess
  startedAt: number
  lastAccessedAt: number
  lastError: string | null
}

const IDLE_TIMEOUT_MS = 90_000
const STARTUP_TIMEOUT_MS = 20_000
const HEAVY_STARTUP_TIMEOUT_MS = 45_000
const sessions = new Map<string, Session>()
const HARDWARE_BACKENDS = ['auto', 'vaapi', 'qsv', 'amf', 'videotoolbox', 'cpu'] as const
const HARDWARE_PROBE_ORDER: Array<Exclude<HardwareBackend, 'auto' | 'cpu'>> =
  process.platform === 'darwin' ? ['videotoolbox', 'qsv', 'amf', 'vaapi'] : ['vaapi', 'qsv', 'amf', 'videotoolbox']

type HardwareBackend = typeof HARDWARE_BACKENDS[number]
let detectedHardwareBackend: Exclude<HardwareBackend, 'auto'> | null = null
let hardwareProbeResults: Partial<Record<Exclude<HardwareBackend, 'auto'>, string>> = {}

function hardwareBackend(value = process.env.TRANSCODE_BACKEND): HardwareBackend {
  value = value?.toLowerCase()
  if (HARDWARE_BACKENDS.includes(value as HardwareBackend)) return value as HardwareBackend
  return 'auto'
}

function resolvedHardwareBackend(value?: string | null) {
  const backend = hardwareBackend(value ?? undefined)
  if (backend === 'auto') {
    if (detectedHardwareBackend) return detectedHardwareBackend

    return probeRecommendedHardwareBackend()
  }
  return backend
}

function encoderForBackend(backend: Exclude<HardwareBackend, 'auto' | 'cpu'>) {
  switch (backend) {
    case 'vaapi':
      return 'h264_vaapi'
    case 'videotoolbox':
      return 'h264_videotoolbox'
    case 'qsv':
      return 'h264_qsv'
    case 'amf':
      return 'h264_amf'
  }
}

function probeFormatForBackend(backend: Exclude<HardwareBackend, 'auto' | 'cpu'>) {
  return backend === 'videotoolbox' ? 'format=yuv420p' : 'format=nv12'
}

function linuxRenderDevicePath() {
  const configured = process.env.TRANSCODE_RENDER_DEVICE?.trim() || process.env.TRANSCODE_QSV_DEVICE?.trim()
  if (configured) return configured

  const defaultDevice = '/dev/dri/renderD128'
  return fs.existsSync(defaultDevice) ? defaultDevice : null
}

function qsvDeviceArgs() {
  const device = linuxRenderDevicePath()
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

function qsvInitMode() {
  if (!linuxRenderDevicePath()) return 'implicit'
  return process.platform === 'linux' ? 'vaapi-derived' : 'direct'
}

function vaapiDeviceArgs() {
  const device = linuxRenderDevicePath()
  return device ? ['-vaapi_device', device] : []
}

function ffmpegEncoders() {
  return execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    timeout: 3000,
  })
}

function probeInputForBackend(backend: Exclude<HardwareBackend, 'auto' | 'cpu'>) {
  return backend === 'qsv' || backend === 'vaapi' ? 'testsrc2=size=1280x720:rate=30' : 'testsrc2=size=640x360:rate=30'
}

function probeArgsForBackend(backend: Exclude<HardwareBackend, 'auto' | 'cpu'>) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    ...(backend === 'vaapi' ? vaapiDeviceArgs() : []),
    ...(backend === 'qsv' ? qsvDeviceArgs() : []),
    '-f', 'lavfi',
    '-i', probeInputForBackend(backend),
    '-frames:v', '30',
    '-vf', backend === 'vaapi' ? 'format=nv12,hwupload' : probeFormatForBackend(backend),
    '-an',
    '-c:v', encoderForBackend(backend),
    ...(backend === 'qsv' ? ['-preset', 'veryfast'] : backend === 'amf' ? ['-quality', 'speed'] : []),
    ...(backend === 'qsv' ? ['-b:v', '3000k', '-maxrate', '4000k', '-bufsize', '6000k'] : []),
    ...(backend === 'vaapi' ? ['-qp', '23'] : []),
    '-f', 'null',
    '-',
  ]
}

function execErrorOutput(err: unknown) {
  if (err && typeof err === 'object') {
    const maybeError = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const output = maybeError.stderr || maybeError.stdout || maybeError.message
    if (Buffer.isBuffer(output)) return output.toString()
    if (typeof output === 'string') return output
  }
  return String(err)
}

function testHardwareBackend(backend: Exclude<HardwareBackend, 'auto' | 'cpu'>, encoders: string) {
  const encoder = encoderForBackend(backend)
  if (!encoders.includes(encoder)) return `${encoder} is not compiled into FFmpeg`

  try {
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', probeArgsForBackend(backend), {
      encoding: 'utf8',
      timeout: 8000,
    })
    return 'ok'
  } catch (err) {
    const message = execErrorOutput(err).trim()
    return message.slice(-1000)
  }
}

function probeRecommendedHardwareBackend() {
  if (detectedHardwareBackend) return detectedHardwareBackend

  let encoders = ''
  try {
    encoders = ffmpegEncoders()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    detectedHardwareBackend = 'cpu'
    hardwareProbeResults = { cpu: `FFmpeg encoder probe failed: ${message.slice(-500)}` }
    process.env.TRANSCODE_RECOMMENDED_BACKEND = detectedHardwareBackend
    console.log(`[transcode] hardware probe selected=${detectedHardwareBackend} reason="${hardwareProbeResults.cpu}"`)
    return detectedHardwareBackend
  }

  hardwareProbeResults = {}
  for (const backend of HARDWARE_PROBE_ORDER) {
    const result = testHardwareBackend(backend, encoders)
    hardwareProbeResults[backend] = result
    console.log(`[transcode] hardware probe backend=${backend} encoder=${encoderForBackend(backend)}${backend === 'qsv' ? ` qsvInit=${qsvInitMode()} renderDevice=${linuxRenderDevicePath() ?? 'none'}` : ''}${backend === 'vaapi' ? ` renderDevice=${linuxRenderDevicePath() ?? 'none'}` : ''} result="${result}"`)
    if (result === 'ok') {
      detectedHardwareBackend = backend
      process.env.TRANSCODE_RECOMMENDED_BACKEND = backend
      process.env.TRANSCODE_RECOMMENDED_ENCODER = encoderForBackend(backend)
      console.log(`[transcode] hardware probe selected=${backend} encoder=${encoderForBackend(backend)} platform=${process.platform}`)
      return detectedHardwareBackend
    }
  }

  detectedHardwareBackend = 'cpu'
  hardwareProbeResults.cpu = 'No tested hardware H.264 encoder completed a validation encode'
  process.env.TRANSCODE_RECOMMENDED_BACKEND = detectedHardwareBackend
  process.env.TRANSCODE_RECOMMENDED_ENCODER = 'libx264'
  console.log(`[transcode] hardware probe selected=${detectedHardwareBackend} encoder=libx264 platform=${process.platform}`)
  return detectedHardwareBackend
}

function transcodeThreads() {
  const raw = process.env.TRANSCODE_THREADS
  if (!raw) return 0

  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.min(parsed, os.cpus().length || parsed)
}

function threadingArgs() {
  const threads = transcodeThreads()
  return [
    '-filter_threads', String(threads || os.cpus().length || 1),
    '-threads', String(threads || os.cpus().length || 1),
  ]
}

function transcodeRoot() {
  const root = path.join(dataPath, 'transcode-cache')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function sessionKey(channelId: number, profile: PlaybackProfile, backend: Exclude<HardwareBackend, 'auto'>) {
  return `${channelId}:${profile}:${backend}`
}

function summarizeArgs(args: string[]) {
  const inputIndex = args.indexOf('-i')
  if (inputIndex >= 0 && inputIndex + 1 < args.length) {
    const sanitized = [...args]
    sanitized[inputIndex + 1] = '[source-url]'
    return sanitized.join(' ')
  }
  return args.join(' ')
}

function startupTimeoutFor(profile: PlaybackProfile) {
  return profile.includes('smooth') || profile.includes('sports') ? HEAVY_STARTUP_TIMEOUT_MS : STARTUP_TIMEOUT_MS
}

function emptyDirectory(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

function inputArgs(sourceUrl: string) {
  return [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '5',
    '-i', sourceUrl,
  ]
}

function hlsArgs(outputDir: string) {
  return [
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+program_date_time',
    '-hls_segment_filename', path.join(outputDir, 'segment_%06d.ts'),
    path.join(outputDir, 'index.m3u8'),
  ]
}

function cpuH264Args(height: number, videoBitrate: string, maxrate: string, bufsize: string, audioBitrate: string) {
  return [
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-vf', `scale=-2:${height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-sc_threshold', '0',
    '-b:v', videoBitrate,
    '-maxrate', maxrate,
    '-bufsize', bufsize,
    '-c:a', 'aac',
    '-b:a', audioBitrate,
  ]
}

function hardwareH264Args(backend: Exclude<HardwareBackend, 'auto'>, height: number, videoBitrate: string, maxrate: string, bufsize: string, audioBitrate: string) {
  if (backend === 'cpu') return cpuH264Args(height, videoBitrate, maxrate, bufsize, audioBitrate)

  if (backend === 'vaapi') {
    return [
      '-map', '0:v:0?', '-map', '0:a:0?',
      '-vf', `scale=-2:${height}:flags=lanczos,format=nv12,hwupload`,
      '-c:v', 'h264_vaapi',
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-qp', height >= 2160 ? '18' : height >= 1080 ? '21' : '23',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
    ]
  }

  if (backend === 'videotoolbox') {
    return [
      '-map', '0:v:0?', '-map', '0:a:0?',
      '-vf', `scale=-2:${height}:flags=lanczos,format=yuv420p`,
      '-c:v', 'h264_videotoolbox',
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-b:v', videoBitrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      '-c:a', 'aac',
      '-b:a', audioBitrate,
    ]
  }

  if (backend === 'amf') {
    return [
      '-map', '0:v:0?', '-map', '0:a:0?',
      '-vf', `scale=-2:${height}:flags=lanczos,format=nv12`,
      '-c:v', 'h264_amf',
      '-quality', 'speed',
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-b:v', videoBitrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      '-c:a', 'aac',
      '-b:a', audioBitrate,
    ]
  }

  return [
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-vf', `scale=-2:${height}:flags=lanczos,format=nv12`,
    '-c:v', 'h264_qsv',
    '-preset', 'veryfast',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-b:v', videoBitrate,
    '-maxrate', maxrate,
    '-bufsize', bufsize,
    '-c:a', 'aac',
    '-b:a', audioBitrate,
  ]
}

function hardwareFilteredH264Args(backend: Exclude<HardwareBackend, 'auto'>, filter: string, videoBitrate: string, maxrate: string, bufsize: string, audioBitrate: string, fps = 60) {
  if (backend === 'cpu') {
    return [
      '-map', '0:v:0?', '-map', '0:a:0?',
      '-vf', `${filter},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-r', String(fps),
      '-g', String(fps * 2),
      '-keyint_min', String(fps * 2),
      '-sc_threshold', '0',
      '-b:v', videoBitrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      '-c:a', 'aac',
      '-b:a', audioBitrate,
    ]
  }

  if (backend === 'vaapi') {
    return [
      '-map', '0:v:0?', '-map', '0:a:0?',
      '-vf', `${filter},format=nv12,hwupload`,
      '-c:v', 'h264_vaapi',
      '-r', String(fps),
      '-g', String(fps * 2),
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-qp', '23',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
    ]
  }

  if (backend === 'videotoolbox') {
    return [
      '-map', '0:v:0?', '-map', '0:a:0?',
      '-vf', `${filter},format=yuv420p`,
      '-c:v', 'h264_videotoolbox',
      '-r', String(fps),
      '-g', String(fps * 2),
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-b:v', videoBitrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      '-c:a', 'aac',
      '-b:a', audioBitrate,
    ]
  }

  if (backend === 'amf') {
    return [
      '-map', '0:v:0?', '-map', '0:a:0?',
      '-vf', `${filter},format=nv12`,
      '-c:v', 'h264_amf',
      '-quality', 'speed',
      '-r', String(fps),
      '-g', String(fps * 2),
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-b:v', videoBitrate,
      '-maxrate', maxrate,
      '-bufsize', bufsize,
      '-c:a', 'aac',
      '-b:a', audioBitrate,
    ]
  }

  return [
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-vf', `${filter},format=nv12`,
    '-c:v', 'h264_qsv',
    '-preset', 'veryfast',
    '-r', String(fps),
    '-g', String(fps * 2),
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-b:v', videoBitrate,
    '-maxrate', maxrate,
    '-bufsize', bufsize,
    '-c:a', 'aac',
    '-b:a', audioBitrate,
  ]
}

function profileArgs(profile: PlaybackProfile, backend: Exclude<HardwareBackend, 'auto'>) {
  switch (profile) {
    case 'stable_hls':
      return ['-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy']
    case 'transcode_720p':
      return hardwareH264Args(backend, 720, '3500k', '4200k', '7000k', '128k')
    case 'transcode_1080p':
      return hardwareH264Args(backend, 1080, '6000k', '7200k', '12000k', '160k')
    case 'transcode_4k':
      return hardwareH264Args(backend, 2160, '22000k', '28000k', '44000k', '192k')
    case 'enhanced_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:1080:flags=lanczos,unsharp=5:5:0.45:3:3:0.25',
        '6500k', '8000k', '13000k', '160k',
        30 // default fps for non-smooth profiles
      )
    case 'clean_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=send_frame:parity=auto:deint=interlaced,hqdn3d=1.5:1.5:4:4,scale=-2:1080:flags=lanczos,unsharp=3:3:0.25:3:3:0.12',
        '6000k', '7500k', '12000k', '160k',
        30
      )
    case 'sharp_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:1080:flags=lanczos,unsharp=7:7:0.65:5:5:0.35',
        '6500k', '8500k', '13000k', '160k',
        30
      )
    case 'smooth_720p60':
      return hardwareFilteredH264Args(
        backend,
        // Note: mi_mode=blend is used instead of mci to support older CPUs. 
        // mci (motion compensation) is extremely heavy and prone to stuttering.
        'scale=-2:720:flags=lanczos,minterpolate=fps=60:mi_mode=blend',
        '5000k', '6500k', '10000k', '160k',
        60
      )
    case 'smooth_1080p60':
      return hardwareFilteredH264Args(
        backend,
        'scale=-2:1080:flags=lanczos,minterpolate=fps=60:mi_mode=blend',
        '8500k', '10000k', '17000k', '160k',
        60
      )
    case 'sports_720p60':
      return hardwareFilteredH264Args(
        backend,
        // Note: minterpolate removed here; yadif send_frame naturally produces 60fps 
        // for 1080i sports feeds without the massive CPU overhead of optical flow.
        'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:720:flags=lanczos,unsharp=5:5:0.35:3:3:0.2',
        '5500k', '7000k', '11000k', '160k',
        60
      )
    case 'sports_lite_720p60':
      return hardwareFilteredH264Args(
        backend,
        // Absolute bare-minimum for 60fps: just deinterlace and scale. 
        // No sharpening or complex interpolation.
        'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:720:flags=lanczos',
        '4500k', '5500k', '9000k', '128k',
        60
      )
    default:
      return ['-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy']
  }
}

function ffmpegArgs(sourceUrl: string, outputDir: string, profile: PlaybackProfile, backend: Exclude<HardwareBackend, 'auto'>) {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostdin',
    '-fflags', '+genpts',
    ...(backend === 'vaapi' ? vaapiDeviceArgs() : []),
    ...(backend === 'qsv' ? qsvDeviceArgs() : []),
    ...threadingArgs(),
    ...inputArgs(sourceUrl),
    ...profileArgs(profile, backend),
    ...hlsArgs(outputDir),
  ]
}

function spawnFfmpeg(args: string[]) {
  return spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

function processStats(pid: number | undefined) {
  if (!pid) return { cpuPercent: null, memoryPercent: null }

  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', '%cpu=', '-o', '%mem='], {
      encoding: 'utf8',
      timeout: 1000,
    }).trim()
    const [cpu, memory] = output.split(/\s+/).map(value => parseFloat(value))
    return {
      cpuPercent: Number.isFinite(cpu) ? cpu : null,
      memoryPercent: Number.isFinite(memory) ? memory : null,
    }
  } catch {
    return { cpuPercent: null, memoryPercent: null }
  }
}

function stopSession(key: string) {
  const session = sessions.get(key)
  if (!session) return
  sessions.delete(key)
  if (!session.process.killed) session.process.kill('SIGTERM')
}

setInterval(() => {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now - session.lastAccessedAt > IDLE_TIMEOUT_MS) stopSession(key)
  }
}, 30_000).unref()

function waitForPlaylist(session: Session) {
  const startedAt = Date.now()
  const startupTimeout = startupTimeoutFor(session.profile)
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (fs.existsSync(session.playlistPath)) {
        resolve()
        return
      }
      if (session.process.exitCode !== null) {
        reject(new Error(session.lastError || `FFmpeg exited with code ${session.process.exitCode}`))
        return
      }
      if (Date.now() - startedAt > startupTimeout) {
        stopSession(session.key)
        reject(new Error(`Timed out waiting for FFmpeg HLS playlist for ${session.profile}${session.lastError ? `: ${session.lastError}` : ''}`))
        return
      }
      setTimeout(check, 250)
    }
    check()
  })
}

export async function ensureTranscodeSession(channel: Channel, playlist: Playlist) {
  const profile = normalizePlaybackProfile(playlist.playbackProfile)
  const backend = resolvedHardwareBackend(playlist.transcodeBackend)
  const key = sessionKey(channel.id, profile, backend)
  const existing = sessions.get(key)
  if (existing && existing.process.exitCode === null) {
    existing.lastAccessedAt = Date.now()
    console.log(`[transcode] reuse channel=${channel.id} name="${channel.displayName}" profile=${profile} backend=${backend} pid=${existing.process.pid ?? 'unknown'}`)
    await waitForPlaylist(existing)
    return existing
  }

  if (existing) sessions.delete(key)

  const outputDir = path.join(transcodeRoot(), String(channel.id), profile, backend)
  emptyDirectory(outputDir)
  const args = ffmpegArgs(channel.streamUrl, outputDir, profile, backend)
  console.log(`[transcode] start channel=${channel.id} name="${channel.displayName}" playlist=${playlist.id} profile=${profile} backend=${backend} requestedBackend=${playlist.transcodeBackend ?? 'auto'} threads=${transcodeThreads() || 'auto'} output=${outputDir}`)
  console.log(`[transcode] ffmpeg channel=${channel.id} args=${summarizeArgs(args)}`)
  const process = spawnFfmpeg(args)
  const session: Session = {
    key,
    channelId: channel.id,
    profile,
    backend,
    sourceUrl: channel.streamUrl,
    outputDir,
    playlistPath: path.join(outputDir, 'index.m3u8'),
    process,
    startedAt: Date.now(),
    lastAccessedAt: Date.now(),
    lastError: null,
  }
  sessions.set(key, session)
  console.log(`[transcode] spawned channel=${channel.id} profile=${profile} backend=${backend} pid=${process.pid ?? 'unknown'}`)

  process.stderr.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim()
    if (message) session.lastError = message.slice(-2000)
  })
  process.on('exit', (code, signal) => {
    const runtimeMs = Date.now() - session.startedAt
    console.log(`[transcode] exit channel=${channel.id} name="${channel.displayName}" profile=${profile} backend=${backend} pid=${process.pid ?? 'unknown'} code=${code ?? 'null'} signal=${signal ?? 'null'} runtimeMs=${runtimeMs}${session.lastError ? ` lastError=${session.lastError}` : ''}`)
    if (sessions.get(key) === session) sessions.delete(key)
  })

  await waitForPlaylist(session)
  return session
}

export function getTranscodeFilePath(channelId: number, profileValue: string | null | undefined, backendValue: string | null | undefined, filePath: string[]) {
  const profile = normalizePlaybackProfile(profileValue)
  const backend = resolvedHardwareBackend(backendValue)
  const safeParts = filePath.filter(part => part && part !== '.' && part !== '..' && !part.includes('/') && !part.includes('\\'))
  const relativePath = safeParts.length > 0 ? safeParts.join(path.sep) : 'index.m3u8'
  const fullPath = path.join(transcodeRoot(), String(channelId), profile, backend, relativePath)
  const root = path.join(transcodeRoot(), String(channelId), profile, backend)
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid transcode path')
  return fullPath
}

export function listTranscodeSessions() {
  return Array.from(sessions.values()).map(session => ({
    channelId: session.channelId,
    profile: session.profile,
    pid: session.process.pid ?? null,
    startedAt: new Date(session.startedAt).toISOString(),
    lastAccessedAt: new Date(session.lastAccessedAt).toISOString(),
    lastError: session.lastError,
    running: session.process.exitCode === null,
    backend: session.backend,
    ...processStats(session.process.pid),
  }))
}

export function getTranscodeHardwareRecommendation() {
  const backend = probeRecommendedHardwareBackend()
  return {
    backend,
    encoder: process.env.TRANSCODE_RECOMMENDED_ENCODER ?? (backend === 'cpu' ? 'libx264' : encoderForBackend(backend)),
    results: hardwareProbeResults,
  }
}

export function runTranscodeHardwareProbe() {
  return getTranscodeHardwareRecommendation()
}
