import { spawn } from 'node:child_process'
import { normalizeAudioProfile } from '@/lib/audio-profile'
import { normalizePlaybackProfile } from '@/lib/playback-profile'
import {
  mpegtsArgs,
  profileArgs,
  qsvDeviceArgs,
  vaapiDeviceArgs,
} from '@/lib/ffmpeg-transcode-args'
import { resolvedHardwareBackend } from '@/lib/server-transcode'
import type { channels, playlists } from '@/lib/schema'

type Channel = typeof channels.$inferSelect
type Playlist = typeof playlists.$inferSelect

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
    ...(backend === 'vaapi' ? vaapiDeviceArgs(null) : []),
    ...(backend === 'qsv' ? qsvDeviceArgs(null) : []),
    '-hide_banner',
    '-loglevel', 'warning',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '5',
    '-i', channel.streamUrl,
    ...profileArgs(profile, backend, { audioProfile }),
    ...mpegtsArgs(),
  ]

  console.log(`[stream] spawning ffmpeg for channel=${channel.id} args=${args.join(' ')}`)
  const process = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  
  return process
}
