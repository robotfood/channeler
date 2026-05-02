export const PLAYBACK_PROFILES = [
  'direct',
  'proxy',
  'stable_mpegts',
  'upscale_1080p',
  'upscale_1080p_v2',
] as const

export type PlaybackProfile = typeof PLAYBACK_PROFILES[number]

export type ProxyProfileMeta = {
  value: Exclude<PlaybackProfile, 'direct'>
  label: string
  detail: string
  fps: string
  res: string
  quality: string
  cpuOnly?: boolean
}

export const PROXY_PROFILES: ProxyProfileMeta[] = [
  {
    value: 'proxy',
    label: 'Proxy passthrough',
    detail: 'Routes the original stream through this server without changing video quality. Ideal buffer: medium.',
    fps: 'Source',
    res: 'Source',
    quality: 'No changes',
  },
  {
    value: 'stable_mpegts',
    label: 'MPEG-TS remux',
    detail: 'Repackages the source into a continuous MPEG-TS stream without re-encoding. Ideal buffer: large.',
    fps: 'Source',
    res: 'Source',
    quality: 'No changes',
  },
  {
    value: 'upscale_1080p',
    label: '1080p upscale',
    detail: 'Re-encodes video to 1080p with libx264 while keeping the same audio processing as remux. Ideal buffer: large.',
    fps: 'Source',
    res: '1080p',
    quality: 'Re-encoded',
    cpuOnly: true,
  },
  {
    value: 'upscale_1080p_v2',
    label: '1080p upscale v2',
    detail: 'Upscales to 1080p using Lanczos + unsharp mask for sharper output, encoded at CRF 16. Higher CPU usage. Ideal buffer: large.',
    fps: 'Source',
    res: '1080p',
    quality: 'Enhanced',
    cpuOnly: true,
  },
]

const PROFILE_MAPPING: Record<string, PlaybackProfile> = {
  'qsv_720p': 'stable_mpegts',
  'qsv_1080p': 'stable_mpegts',
  'qsv_4k': 'stable_mpegts',
  'transcode_720p': 'stable_mpegts',
  'transcode_1080p': 'stable_mpegts',
  'transcode_4k': 'stable_mpegts',
  'enhanced_1080p': 'stable_mpegts',
  'clean_1080p': 'stable_mpegts',
  'repair_1080p': 'stable_mpegts',
  'smooth_720p60': 'stable_mpegts',
  'smooth_1080p60': 'stable_mpegts',
  'hardware_smooth_720p60': 'stable_mpegts',
  'hardware_sports_720p60': 'stable_mpegts',
  'sports_720p60': 'stable_mpegts',
  'stable_hls': 'stable_mpegts',
}

export function normalizePlaybackProfile(value: string | null | undefined): PlaybackProfile {
  if (!value) return 'direct'
  if (PROFILE_MAPPING[value]) return PROFILE_MAPPING[value]
  return PLAYBACK_PROFILES.includes(value as PlaybackProfile) ? value as PlaybackProfile : 'direct'
}
