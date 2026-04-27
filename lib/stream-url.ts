import { normalizePlaybackProfile, usesTranscodedHls } from '@/lib/playback-profile'

export function channelPlaybackUrl(channelId: number, sourceUrl: string, options: {
  baseUrl?: string
  playbackProfile?: string | null
  proxyStreams?: boolean
}) {
  const prefix = options.baseUrl ?? ''
  const profile = normalizePlaybackProfile(options.playbackProfile)
  if (usesTranscodedHls(profile)) return `${prefix}/api/transcode/${channelId}/index.m3u8`
  if (profile === 'proxy' || options.proxyStreams) return `${prefix}/api/stream/${channelId}`
  return sourceUrl
}
