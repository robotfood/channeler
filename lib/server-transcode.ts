import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
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
  sourceUrl: string
  outputDir: string
  playlistPath: string
  process: ChildProcess
  startedAt: number
  lastAccessedAt: number
  lastError: string | null
}

const IDLE_TIMEOUT_MS = 90_000
const STARTUP_TIMEOUT_MS = 15_000
const sessions = new Map<string, Session>()

function transcodeRoot() {
  const root = path.join(dataPath, 'transcode-cache')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function sessionKey(channelId: number, profile: PlaybackProfile) {
  return `${channelId}:${profile}`
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
    '-hls_time', '4',
    '-hls_list_size', '8',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+program_date_time',
    '-hls_segment_filename', path.join(outputDir, 'segment_%06d.ts'),
    path.join(outputDir, 'index.m3u8'),
  ]
}

function profileArgs(profile: PlaybackProfile) {
  switch (profile) {
    case 'stable_hls':
      return ['-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy']
    case 'transcode_720p':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'scale=-2:720:flags=lanczos,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', '3500k',
        '-maxrate', '4200k',
        '-bufsize', '7000k',
        '-c:a', 'aac',
        '-b:a', '128k',
      ]
    case 'transcode_1080p':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'scale=-2:1080:flags=lanczos,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', '6000k',
        '-maxrate', '7200k',
        '-bufsize', '12000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    case 'qsv_720p':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'scale=-2:720:flags=lanczos,format=nv12',
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-b:v', '3500k',
        '-maxrate', '4200k',
        '-bufsize', '7000k',
        '-c:a', 'aac',
        '-b:a', '128k',
      ]
    case 'qsv_1080p':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'scale=-2:1080:flags=lanczos,format=nv12',
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-b:v', '6000k',
        '-maxrate', '7200k',
        '-bufsize', '12000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    case 'enhanced_1080p':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:1080:flags=lanczos,unsharp=5:5:0.45:3:3:0.25,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', '6500k',
        '-maxrate', '8000k',
        '-bufsize', '13000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    case 'clean_1080p':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'yadif=mode=send_frame:parity=auto:deint=interlaced,hqdn3d=1.5:1.5:4:4,scale=-2:1080:flags=lanczos,unsharp=3:3:0.25:3:3:0.12,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', '6000k',
        '-maxrate', '7500k',
        '-bufsize', '12000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    case 'sharp_1080p':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:1080:flags=lanczos,unsharp=7:7:0.65:5:5:0.35,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', '6500k',
        '-maxrate', '8500k',
        '-bufsize', '13000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    case 'smooth_720p60':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'scale=-2:720:flags=lanczos,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-r', '60',
        '-b:v', '5000k',
        '-maxrate', '6500k',
        '-bufsize', '10000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    case 'smooth_1080p60':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'scale=-2:1080:flags=lanczos,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-r', '60',
        '-b:v', '8500k',
        '-maxrate', '10000k',
        '-bufsize', '17000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    case 'sports_720p60':
      return [
        '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', 'yadif=mode=send_frame:parity=auto:deint=interlaced,scale=-2:720:flags=lanczos,unsharp=5:5:0.35:3:3:0.2,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-r', '60',
        '-b:v', '5500k',
        '-maxrate', '7000k',
        '-bufsize', '11000k',
        '-c:a', 'aac',
        '-b:a', '160k',
      ]
    default:
      return ['-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy']
  }
}

function spawnFfmpeg(sourceUrl: string, outputDir: string, profile: PlaybackProfile) {
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostdin',
    '-fflags', '+genpts',
    ...inputArgs(sourceUrl),
    ...profileArgs(profile),
    ...hlsArgs(outputDir),
  ]
  return spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
      if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
        reject(new Error('Timed out waiting for FFmpeg HLS playlist'))
        return
      }
      setTimeout(check, 250)
    }
    check()
  })
}

export async function ensureTranscodeSession(channel: Channel, playlist: Playlist) {
  const profile = normalizePlaybackProfile(playlist.playbackProfile)
  const key = sessionKey(channel.id, profile)
  const existing = sessions.get(key)
  if (existing && existing.process.exitCode === null) {
    existing.lastAccessedAt = Date.now()
    await waitForPlaylist(existing)
    return existing
  }

  if (existing) sessions.delete(key)

  const outputDir = path.join(transcodeRoot(), String(channel.id), profile)
  emptyDirectory(outputDir)
  const process = spawnFfmpeg(channel.streamUrl, outputDir, profile)
  const session: Session = {
    key,
    channelId: channel.id,
    profile,
    sourceUrl: channel.streamUrl,
    outputDir,
    playlistPath: path.join(outputDir, 'index.m3u8'),
    process,
    startedAt: Date.now(),
    lastAccessedAt: Date.now(),
    lastError: null,
  }
  sessions.set(key, session)

  process.stderr.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim()
    if (message) session.lastError = message.slice(-2000)
  })
  process.on('exit', () => {
    if (sessions.get(key) === session) sessions.delete(key)
  })

  await waitForPlaylist(session)
  return session
}

export function getTranscodeFilePath(channelId: number, profileValue: string | null | undefined, filePath: string[]) {
  const profile = normalizePlaybackProfile(profileValue)
  const safeParts = filePath.filter(part => part && part !== '.' && part !== '..' && !part.includes('/') && !part.includes('\\'))
  const relativePath = safeParts.length > 0 ? safeParts.join(path.sep) : 'index.m3u8'
  const fullPath = path.join(transcodeRoot(), String(channelId), profile, relativePath)
  const root = path.join(transcodeRoot(), String(channelId), profile)
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid transcode path')
  return fullPath
}

export function listTranscodeSessions() {
  return Array.from(sessions.values()).map(session => ({
    channelId: session.channelId,
    profile: session.profile,
    startedAt: new Date(session.startedAt).toISOString(),
    lastAccessedAt: new Date(session.lastAccessedAt).toISOString(),
    lastError: session.lastError,
    running: session.process.exitCode === null,
  }))
}
