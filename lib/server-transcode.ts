import { execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import {
  encoderForBackend,
  probeFormatForBackend,
  qsvDeviceArgs as qsvDeviceArgsForDevice,
  TRANSCODE_BACKENDS,
  type TranscodeBackend,
  vaapiDeviceArgs as vaapiDeviceArgsForDevice,
} from '@/lib/ffmpeg-transcode-args'
import type { AudioProfile } from '@/lib/audio-profile'
import type { PlaybackProfile } from '@/lib/playback-profile'

type HardwareBackend = 'auto' | TranscodeBackend
type StreamSession = {
  key: string
  channelId: number
  profile: PlaybackProfile
  backend: Exclude<HardwareBackend, 'auto'>
  audioProfile: AudioProfile
  pid: number | null
  startedAt: number
  lastAccessedAt: number
  lastError: string | null
  process: ChildProcess
}

const FORCE_KILL_TIMEOUT_MS = 5_000
const HARDWARE_BACKENDS = ['auto', ...TRANSCODE_BACKENDS] as const
let sessionCounter = 0
const HARDWARE_PROBE_ORDER: Array<Exclude<HardwareBackend, 'auto' | 'cpu'>> =
  process.platform === 'darwin' ? ['videotoolbox', 'qsv', 'amf', 'vaapi'] : ['vaapi', 'qsv', 'amf', 'videotoolbox']
const streamSessions = new Map<string, StreamSession>()

let detectedHardwareBackend: Exclude<HardwareBackend, 'auto'> | null = null
let hardwareProbeResults: Partial<Record<Exclude<HardwareBackend, 'auto'>, string>> = {}
let qsvFallbackToDirectInit = false

const QSV_VAAPI_ERROR_PATTERNS = [
  'unsupported picture structure',
  'unsupported resolution',
  'unsupported pixel format',
  'error during encoding',
]

function isQsvVaapiError(message: string) {
  const lower = message.toLowerCase()
  return QSV_VAAPI_ERROR_PATTERNS.some(p => lower.includes(p))
}

function isHardwareBackend(v: string): v is HardwareBackend {
  return (HARDWARE_BACKENDS as readonly string[]).includes(v)
}

function hardwareBackend(value = process.env.TRANSCODE_BACKEND): HardwareBackend {
  const lower = value?.toLowerCase()
  if (lower && isHardwareBackend(lower)) return lower
  return 'auto'
}

export function resolvedHardwareBackend(value?: string | null): Exclude<HardwareBackend, 'auto'> {
  const backend = hardwareBackend(value ?? undefined)
  if (backend === 'auto') {
    if (detectedHardwareBackend) return detectedHardwareBackend
    return probeRecommendedHardwareBackend()
  }
  return backend
}

export function transcodeRenderDevicePath() {
  const configured = process.env.TRANSCODE_RENDER_DEVICE?.trim() || process.env.TRANSCODE_QSV_DEVICE?.trim()
  if (configured) return configured

  const defaultDevice = '/dev/dri/renderD128'
  return fs.existsSync(defaultDevice) ? defaultDevice : null
}

function qsvDeviceArgs() {
  if (qsvFallbackToDirectInit) {
    // vaapi-derived init failed on this host (Xeon/server GPU); use direct QSV init instead
    return ['-init_hw_device', 'qsv=qsv:hw', '-filter_hw_device', 'qsv']
  }
  return qsvDeviceArgsForDevice(transcodeRenderDevicePath())
}

function qsvInitMode() {
  if (qsvFallbackToDirectInit) return 'direct-hw'
  if (!transcodeRenderDevicePath()) return 'implicit'
  return process.platform === 'linux' ? 'vaapi-derived' : 'direct'
}

function vaapiDeviceArgs() {
  return vaapiDeviceArgsForDevice(transcodeRenderDevicePath())
}

function ffmpegEncoders() {
  return execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    timeout: 3000,
  })
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

export function assertFfmpegAvailable() {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const message = execErrorOutput(err).trim()
    throw new Error(
      `FFmpeg is required but could not be started from "${ffmpegPath}". ` +
      `Install ffmpeg or set FFMPEG_PATH to the ffmpeg binary.${message ? `\n${message}` : ''}`
    )
  }
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
    const result = message.slice(-1000)

    // On Linux, vaapi-derived QSV init fails on Xeon/server GPUs with format/structure errors
    // even when QSV itself works. Retry with direct QSV init before declaring failure.
    if (
      backend === 'qsv' &&
      process.platform === 'linux' &&
      !qsvFallbackToDirectInit &&
      transcodeRenderDevicePath() &&
      isQsvVaapiError(result)
    ) {
      console.log(`[transcode] QSV vaapi-derived init failed, retrying with direct init: ${result.slice(0, 120)}`)
      qsvFallbackToDirectInit = true
      try {
        execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', probeArgsForBackend(backend), {
          encoding: 'utf8',
          timeout: 8000,
        })
        console.log('[transcode] QSV direct init succeeded')
        return 'ok'
      } catch (retryErr) {
        qsvFallbackToDirectInit = false
        return execErrorOutput(retryErr).trim().slice(-1000)
      }
    }

    return result
  }
}

function probeRecommendedHardwareBackend(): Exclude<HardwareBackend, 'auto'> {
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
    console.log(`[transcode] hardware probe backend=${backend} encoder=${encoderForBackend(backend)}${backend === 'qsv' ? ` qsvInit=${qsvInitMode()} renderDevice=${transcodeRenderDevicePath() ?? 'none'}` : ''}${backend === 'vaapi' ? ` renderDevice=${transcodeRenderDevicePath() ?? 'none'}` : ''} result="${result}"`)
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

function sessionKey(channelId: number, profile: PlaybackProfile, backend: Exclude<HardwareBackend, 'auto'>, audioProfile: AudioProfile, pid: number | undefined) {
  return `${channelId}:${profile}:${backend}:${audioProfile}:${pid ?? `seq${++sessionCounter}`}`
}

export function registerStreamSession(args: {
  channelId: number
  profile: PlaybackProfile
  backend: Exclude<HardwareBackend, 'auto'>
  audioProfile: AudioProfile
  process: ChildProcess
}) {
  const key = sessionKey(args.channelId, args.profile, args.backend, args.audioProfile, args.process.pid)
  const session: StreamSession = {
    key,
    channelId: args.channelId,
    profile: args.profile,
    backend: args.backend,
    audioProfile: args.audioProfile,
    pid: args.process.pid ?? null,
    startedAt: Date.now(),
    lastAccessedAt: Date.now(),
    lastError: null,
    process: args.process,
  }
  streamSessions.set(key, session)

  args.process.stderr?.on('data', chunk => {
    const message = chunk.toString().trim()
    if (message) session.lastError = message.slice(-1000)
  })
  args.process.once('exit', () => streamSessions.delete(key))

  return session
}

export function touchStreamSession(key: string) {
  const session = streamSessions.get(key)
  if (session) session.lastAccessedAt = Date.now()
}

export function stopTranscodeSessionsForChannel(channelId: number) {
  let stopped = 0
  for (const [key, session] of Array.from(streamSessions.entries())) {
    if (session.channelId !== channelId) continue
    streamSessions.delete(key)
    if (session.process.exitCode === null) {
      session.process.kill('SIGTERM')
      const forceKillTimer = setTimeout(() => {
        if (session.process.exitCode === null) session.process.kill('SIGKILL')
      }, FORCE_KILL_TIMEOUT_MS)
      forceKillTimer.unref()
    }
    stopped += 1
  }
  return stopped
}

export function listTranscodeSessions() {
  return Array.from(streamSessions.values()).map(session => ({
    channelId: session.channelId,
    profile: session.profile,
    backend: session.backend,
    audioProfile: session.audioProfile,
    pid: session.pid,
    running: session.process.exitCode === null,
    startedAt: session.startedAt,
    lastAccessedAt: session.lastAccessedAt,
    lastError: session.lastError,
    cpuPercent: null,
    memoryPercent: null,
  }))
}

export function getTranscodeHardwareRecommendation() {
  const backend = resolvedHardwareBackend()
  return {
    backend,
    encoder: encoderForBackend(backend),
    results: hardwareProbeResults,
    renderDevice: transcodeRenderDevicePath(),
  }
}

export function recommendedTranscodeBackend() {
  return getTranscodeHardwareRecommendation()
}

export function runTranscodeHardwareProbe() {
  return getTranscodeHardwareRecommendation()
}
