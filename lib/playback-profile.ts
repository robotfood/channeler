export const PLAYBACK_PROFILES = [
  'direct',
  'proxy',
  'stable_hls',
  'transcode_720p',
  'transcode_1080p',
  'qsv_720p',
  'qsv_1080p',
  'enhanced_1080p',
  'clean_1080p',
  'sharp_1080p',
  'smooth_720p60',
  'smooth_1080p60',
  'sports_720p60',
] as const

export type PlaybackProfile = typeof PLAYBACK_PROFILES[number]

export function normalizePlaybackProfile(value: string | null | undefined): PlaybackProfile {
  return PLAYBACK_PROFILES.includes(value as PlaybackProfile) ? value as PlaybackProfile : 'direct'
}

export function usesTranscodedHls(profile: string | null | undefined) {
  const normalized = normalizePlaybackProfile(profile)
  return normalized !== 'direct' && normalized !== 'proxy'
}
