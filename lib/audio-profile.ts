export const AUDIO_PROFILES = ['aac_stereo', 'standard', 'loudnorm', 'surround_5_1', 'surround_5_1_aggressive'] as const
export type AudioProfile = typeof AUDIO_PROFILES[number]

export type AudioProfileMeta = {
  value: AudioProfile
  label: string
  detail: string
}

export const AUDIO_PROFILE_DEFS: AudioProfileMeta[] = [
  {
    value: 'aac_stereo',
    label: 'AAC stereo',
    detail: 'Re-encodes audio to 256k AAC without any normalization or processing.',
  },
  {
    value: 'standard',
    label: 'AAC + level normalize',
    detail: 'Re-encodes audio to 256k AAC with light dynamic normalization while preserving the source channel layout.',
  },
  {
    value: 'loudnorm',
    label: 'AAC + loudnorm (EBU R128)',
    detail: 'Re-encodes to 256k AAC targeting -16 LUFS. More natural-sounding than dynaudnorm for broadcast content.',
  },
  {
    value: 'surround_5_1',
    label: 'Stereo to 5.1',
    detail: 'Applies stronger volume normalization and a conservative stereo-to-5.1 upmix at higher bitrate. Best for stereo sources only.',
  },
  {
    value: 'surround_5_1_aggressive',
    label: 'Aggressive stereo to 5.1',
    detail: 'Pushes stereo harder into the surround field with extra focus, LFE routing, and output gain. Most processed option.',
  },
]

export function normalizeAudioProfile(value: string | null | undefined): AudioProfile {
  if (value === 'enhanced_5_1') return 'surround_5_1_aggressive'
  if (value === 'none') return 'aac_stereo'
  return AUDIO_PROFILES.includes(value as AudioProfile) ? value as AudioProfile : 'aac_stereo'
}
