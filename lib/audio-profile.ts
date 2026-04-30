export const AUDIO_PROFILES = ['standard', 'surround_5_1', 'surround_5_1_aggressive'] as const
export type AudioProfile = typeof AUDIO_PROFILES[number]

export function normalizeAudioProfile(value: string | null | undefined): AudioProfile {
  if (value === 'enhanced_5_1') return 'surround_5_1_aggressive'
  return AUDIO_PROFILES.includes(value as AudioProfile) ? value as AudioProfile : 'standard'
}
