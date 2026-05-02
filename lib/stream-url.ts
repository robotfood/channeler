import { normalizePlaybackProfile } from '@/lib/playback-profile'

export function channelPlaybackUrl(channelId: number, sourceUrl: string, options: {
  baseUrl?: string
  playbackProfile?: string | null
  proxyStreams?: boolean
}) {
  const prefix = options.baseUrl ?? ''
  const profile = normalizePlaybackProfile(options.playbackProfile)
  if (profile !== 'direct' || options.proxyStreams) return `${prefix}/api/stream/${channelId}`
  return sourceUrl
}
