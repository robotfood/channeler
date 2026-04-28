export const PLAYBACK_PROFILES = [
  'direct',
  'proxy',
  'stable_hls',
  'transcode_720p',
  'transcode_1080p',
  'transcode_4k',
  'transcode_4k_fast',
  'enhanced_1080p',
  'clean_1080p',
  'sharp_1080p',
  'smooth_720p60',
  'smooth_1080p60',
  'sports_720p60',
  'sports_lite_720p60',
] as const

export type PlaybackProfile = typeof PLAYBACK_PROFILES[number]

const PROFILE_MAPPING: Record<string, PlaybackProfile> = {
  'qsv_720p': 'transcode_720p',
  'qsv_1080p': 'transcode_1080p',
  'qsv_4k': 'transcode_4k',
  'hardware_smooth_720p60': 'smooth_720p60',
  'hardware_sports_720p60': 'sports_720p60',
}

export function normalizePlaybackProfile(value: string | null | undefined): PlaybackProfile {
  if (!value) return 'direct'
  if (PROFILE_MAPPING[value]) return PROFILE_MAPPING[value]
  return PLAYBACK_PROFILES.includes(value as PlaybackProfile) ? value as PlaybackProfile : 'direct'
}

export function usesTranscodedHls(profile: string | null | undefined) {
  const normalized = normalizePlaybackProfile(profile)
  return normalized !== 'direct' && normalized !== 'proxy'
}
