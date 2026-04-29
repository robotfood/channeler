export const AUDIO_PROFILES = ['standard', 'enhanced_5_1'] as const
export type AudioProfile = typeof AUDIO_PROFILES[number]

export function normalizeAudioProfile(value: string | null | undefined): AudioProfile {
  return AUDIO_PROFILES.includes(value as AudioProfile) ? value as AudioProfile : 'standard'
}
