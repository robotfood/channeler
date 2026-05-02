import { spawn } from 'node:child_process'
import { normalizeAudioProfile } from '@/lib/audio-profile'
import { normalizePlaybackProfile } from '@/lib/playback-profile'
import {
  mpegtsArgs,
  profileArgs,
  qsvDeviceArgs,
  vaapiDeviceArgs,
} from '@/lib/ffmpeg-transcode-args'
import { registerStreamSession, resolvedHardwareBackend, transcodeRenderDevicePath } from '@/lib/server-transcode'
import type { channels, playlists } from '@/lib/schema'

type Channel = typeof channels.$inferSelect
type Playlist = typeof playlists.$inferSelect

function isLikelyHlsSource(url: string) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8')
  } catch {
    return url.toLowerCase().split('?')[0].endsWith('.m3u8')
  }
}

/**
 * Spawns an FFmpeg process that transcodes a channel stream into MPEG-TS 
 * and pipes it to stdout.
 */
export function spawnMpegtsStream(channel: Channel, playlist: Playlist) {
  const profile = normalizePlaybackProfile(playlist.playbackProfile)
  const audioProfile = normalizeAudioProfile(playlist.audioProfile)
  const backend = resolvedHardwareBackend(playlist.transcodeBackend)
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

  const args = [
    '-nostdin',
    ...(backend === 'vaapi' ? vaapiDeviceArgs(transcodeRenderDevicePath()) : []),
    ...(backend === 'qsv' ? qsvDeviceArgs(transcodeRenderDevicePath()) : []),
    '-hide_banner',
    '-loglevel', 'warning',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    ...(isLikelyHlsSource(channel.streamUrl) ? [] : ['-reconnect_at_eof', '1']),
    '-reconnect_on_network_error', '1',
    '-reconnect_on_http_error', '4xx,5xx',
    '-reconnect_delay_max', '5',
    '-rw_timeout', '15000000',
    '-i', channel.streamUrl,
    ...profileArgs(profile, backend, { audioProfile }),
    ...mpegtsArgs(),
  ]

  console.log(`[stream] spawning ffmpeg for channel=${channel.id} args=${args.join(' ')}`)
  const ffmpegProcess = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  registerStreamSession({
    channelId: channel.id,
    profile,
    backend,
    audioProfile,
    process: ffmpegProcess,
  })
  
  return ffmpegProcess
}
