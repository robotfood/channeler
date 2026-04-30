import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeAudioProfile, type AudioProfile } from '@/lib/audio-profile'
import { dataPath } from '@/lib/data-path'
import {
  encoderForBackend,
  hlsArgs,
  profileArgs,
  probeFormatForBackend,
  qsvDeviceArgs as qsvDeviceArgsForDevice,
  TRANSCODE_BACKENDS,
  type TranscodeBackend,
  vaapiDeviceArgs as vaapiDeviceArgsForDevice,
} from '@/lib/ffmpeg-transcode-args'
import { normalizePlaybackProfile, type PlaybackProfile } from '@/lib/playback-profile'
import type { channels, playlists } from '@/lib/schema'

type Channel = typeof channels.$inferSelect
type Playlist = typeof playlists.$inferSelect

type Session = {
  key: string
  channelId: number
  profile: PlaybackProfile
  backend: Exclude<HardwareBackend, 'auto'>
  audioProfile: AudioProfile
  sourceUrl: string
  outputDir: string
  playlistPath: string
  process: ChildProcess
  startedAt: number
  lastAccessedAt: number
  lastError: string | null
  terminationTimer: ReturnType<typeof setTimeout> | null
}

const IDLE_TIMEOUT_MS = 90_000
const STARTUP_TIMEOUT_MS = 20_000
const HEAVY_STARTUP_TIMEOUT_MS = 45_000
const FORCE_KILL_TIMEOUT_MS = 5_000
const sessions = new Map<string, Session>()
const HARDWARE_BACKENDS = ['auto', ...TRANSCODE_BACKENDS] as const
const HARDWARE_PROBE_ORDER: Array<Exclude<HardwareBackend, 'auto' | 'cpu'>> =
  process.platform === 'darwin' ? ['videotoolbox', 'qsv', 'amf', 'vaapi'] : ['vaapi', 'qsv', 'amf', 'videotoolbox']

type HardwareBackend = 'auto' | TranscodeBackend
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

function linuxRenderDevicePath() {
  const configured = process.env.TRANSCODE_RENDER_DEVICE?.trim() || process.env.TRANSCODE_QSV_DEVICE?.trim()
  if (configured) return configured

  const defaultDevice = '/dev/dri/renderD128'
  return fs.existsSync(defaultDevice) ? defaultDevice : null
}

function qsvDeviceArgs() {
  return qsvDeviceArgsForDevice(linuxRenderDevicePath())
}

function qsvInitMode() {
  if (!linuxRenderDevicePath()) return 'implicit'
  return process.platform === 'linux' ? 'vaapi-derived' : 'direct'
}

function vaapiDeviceArgs() {
  return vaapiDeviceArgsForDevice(linuxRenderDevicePath())
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

function sessionKey(channelId: number, profile: PlaybackProfile, backend: Exclude<HardwareBackend, 'auto'>, audioProfile: AudioProfile) {
  return `${channelId}:${profile}:${backend}:${audioProfile}`
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

function ffmpegArgs(sourceUrl: string, outputDir: string, profile: PlaybackProfile, backend: Exclude<HardwareBackend, 'auto'>, audioProfile: AudioProfile) {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostdin',
    '-fflags', '+genpts',
    ...(backend === 'vaapi' ? vaapiDeviceArgs() : []),
    ...(backend === 'qsv' ? qsvDeviceArgs() : []),
    ...threadingArgs(),
    ...inputArgs(sourceUrl),
    ...profileArgs(profile, backend, { audioProfile }),
    ...hlsArgs(outputDir),
  ]
}

function spawnFfmpeg(args: string[]) {
  return spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
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

function terminateSession(session: Session, reason: string) {
  if (session.terminationTimer) return

  if (session.process.exitCode !== null) return

  console.log(`[transcode] stopping channel=${session.channelId} profile=${session.profile} backend=${session.backend} audio=${session.audioProfile} pid=${session.process.pid ?? 'unknown'} reason=${reason}`)
  session.process.kill('SIGTERM')
  session.terminationTimer = setTimeout(() => {
    if (session.process.exitCode === null) {
      console.warn(`[transcode] force-killing channel=${session.channelId} profile=${session.profile} backend=${session.backend} audio=${session.audioProfile} pid=${session.process.pid ?? 'unknown'} reason=${reason}`)
      session.process.kill('SIGKILL')
    }
  }, FORCE_KILL_TIMEOUT_MS)
  session.terminationTimer.unref()
}

function stopSession(key: string, reason = 'idle') {
  const session = sessions.get(key)
  if (!session) return
  sessions.delete(key)
  terminateSession(session, reason)
}

function stopAllSessions(reason: string) {
  let stopped = 0
  for (const key of Array.from(sessions.keys())) {
    stopSession(key, reason)
    stopped += 1
  }
  return stopped
}

export function stopTranscodeSessionsForChannel(channelId: number) {
  let stopped = 0
  for (const [key, session] of Array.from(sessions.entries())) {
    if (session.channelId !== channelId) continue
    stopSession(key, 'requested')
    stopped += 1
  }
  return stopped
}

setInterval(() => {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now - session.lastAccessedAt > IDLE_TIMEOUT_MS) stopSession(key, 'idle')
  }
}, 30_000).unref()

const shutdownHandlersRegisteredKey = Symbol.for('channeler.transcodeShutdownHandlersRegistered')
const globalState = globalThis as typeof globalThis & { [shutdownHandlersRegisteredKey]?: boolean }

if (!globalState[shutdownHandlersRegisteredKey]) {
  globalState[shutdownHandlersRegisteredKey] = true

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const stopped = stopAllSessions(`process-${signal}`)
      const exitCode = signal === 'SIGINT' ? 130 : 143
      if (stopped === 0) {
        process.exit(exitCode)
        return
      }

      setTimeout(() => process.exit(exitCode), FORCE_KILL_TIMEOUT_MS + 250)
    })
  }

  process.once('beforeExit', () => stopAllSessions('process-beforeExit'))
}

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
        stopSession(session.key, 'startup-timeout')
        reject(new Error(`Timed out waiting for FFmpeg HLS playlist for ${session.profile}${session.lastError ? `: ${session.lastError}` : ''}`))
        return
      }
      setTimeout(check, 250)
    }
    check()
  })
}

function startTranscodeSession(channel: Channel, playlist: Playlist, profile: PlaybackProfile, backend: Exclude<HardwareBackend, 'auto'>, audioProfile: AudioProfile) {
  const key = sessionKey(channel.id, profile, backend, audioProfile)
  const existing = sessions.get(key)
  if (existing && existing.process.exitCode === null) {
    existing.lastAccessedAt = Date.now()
    console.log(`[transcode] reuse channel=${channel.id} name="${channel.displayName}" profile=${profile} backend=${backend} audio=${audioProfile} pid=${existing.process.pid ?? 'unknown'}`)
    return existing
  }

  if (existing) sessions.delete(key)

  const outputDir = path.join(transcodeRoot(), String(channel.id), profile, backend, audioProfile)
  emptyDirectory(outputDir)
  const args = ffmpegArgs(channel.streamUrl, outputDir, profile, backend, audioProfile)
  console.log(`[transcode] start channel=${channel.id} name="${channel.displayName}" playlist=${playlist.id} profile=${profile} backend=${backend} audio=${audioProfile} requestedBackend=${playlist.transcodeBackend ?? 'auto'} threads=${transcodeThreads() || 'auto'} output=${outputDir}`)
  console.log(`[transcode] ffmpeg channel=${channel.id} args=${summarizeArgs(args)}`)
  const process = spawnFfmpeg(args)
  const session: Session = {
    key,
    channelId: channel.id,
    profile,
    backend,
    audioProfile,
    sourceUrl: channel.streamUrl,
    outputDir,
    playlistPath: path.join(outputDir, 'index.m3u8'),
    process,
    startedAt: Date.now(),
    lastAccessedAt: Date.now(),
    lastError: null,
    terminationTimer: null,
  }
  sessions.set(key, session)
  console.log(`[transcode] spawned channel=${channel.id} profile=${profile} backend=${backend} audio=${audioProfile} pid=${process.pid ?? 'unknown'}`)

  process.stderr.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim()
    if (message) session.lastError = `${session.lastError ? `${session.lastError}\n` : ''}${message}`.slice(-4000)
  })
  process.on('exit', (code, signal) => {
    if (session.terminationTimer) {
      clearTimeout(session.terminationTimer)
      session.terminationTimer = null
    }
    const runtimeMs = Date.now() - session.startedAt
    console.log(`[transcode] exit channel=${channel.id} name="${channel.displayName}" profile=${profile} backend=${backend} audio=${audioProfile} pid=${process.pid ?? 'unknown'} code=${code ?? 'null'} signal=${signal ?? 'null'} runtimeMs=${runtimeMs}${session.lastError ? ` lastError=${session.lastError}` : ''}`)
    if (sessions.get(key) === session) sessions.delete(key)
  })

  return session
}

export async function ensureTranscodeSession(channel: Channel, playlist: Playlist) {
  const profile = normalizePlaybackProfile(playlist.playbackProfile)
  const audioProfile = normalizeAudioProfile(playlist.audioProfile)
  const backend = resolvedHardwareBackend(playlist.transcodeBackend)
  const session = startTranscodeSession(channel, playlist, profile, backend, audioProfile)

  try {
    await waitForPlaylist(session)
    return session
  } catch (err) {
    if (backend === 'cpu') throw err

    console.warn(`[transcode] startup failed; falling back to cpu channel=${channel.id} profile=${profile} backend=${backend} audio=${audioProfile} error=${err instanceof Error ? err.message : String(err)}`)
    stopSession(session.key, 'startup-failed')
    const fallback = startTranscodeSession(channel, playlist, profile, 'cpu', audioProfile)
    await waitForPlaylist(fallback)
    return fallback
  }
}

export function getTranscodeSessionFilePath(session: Pick<Session, 'outputDir'>, filePath: string[]) {
  const safeParts = filePath.filter(part => part && part !== '.' && part !== '..' && !part.includes('/') && !part.includes('\\'))
  const relativePath = safeParts.length > 0 ? safeParts.join(path.sep) : 'index.m3u8'
  const root = session.outputDir
  const fullPath = path.join(root, relativePath)
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
    audioProfile: session.audioProfile,
    ...processStats(session.process.pid),
  }))
}

export function getTranscodeHardwareRecommendation() {
  const backend = probeRecommendedHardwareBackend()
  return {
    backend,
    encoder: process.env.TRANSCODE_RECOMMENDED_ENCODER ?? (backend === 'cpu' ? 'libx264' : encoderForBackend(backend)),
    results: hardwareProbeResults,
    cpuCores: os.cpus().length,
    threading: transcodeThreads() || 'auto (all cores)',
  }
}

export function runTranscodeHardwareProbe() {
  return getTranscodeHardwareRecommendation()
}
