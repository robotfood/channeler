import { normalizeAudioProfile, type AudioProfile } from '@/lib/audio-profile'
import type { PlaybackProfile } from '@/lib/playback-profile'

export const TRANSCODE_BACKENDS = ['vaapi', 'qsv', 'amf', 'videotoolbox', 'cpu'] as const
export type TranscodeBackend = typeof TRANSCODE_BACKENDS[number]

type StreamMap = {
  videoInputIndex?: number
  audioInputIndex?: number
}

type ProfileArgsOptions = StreamMap & {
  audioProfile?: string | null
}

type EncodingBudget = {
  audioBitrate: string
  enhancedAudioBitrate: string
}

const ENCODING_BUDGETS = {
  mpegtsRemuxAudio: { audioBitrate: '256k', enhancedAudioBitrate: '384k' },
} as const

const AUDIO_FILTERS = {
  lightNormalize: 'dynaudnorm=f=120:g=8:p=0.96',
  loudnorm: 'loudnorm=I=-16:TP=-1.5:LRA=11',
  surroundSafe: 'aformat=channel_layouts=stereo,dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1',
  surroundAggressive: 'aformat=channel_layouts=stereo,dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1:focus=0.8:angle=65:smooth=0.2:level_out=1.15:lfe_mode=add:lfe_low=80:lfe_high=180',
} as const

function streamMapArgs({ videoInputIndex = 0, audioInputIndex = 0 }: StreamMap = {}) {
  return ['-map', `${videoInputIndex}:v:0?`, '-map', `${audioInputIndex}:a:0?`, '-map', `${videoInputIndex}:s?`, '-c:s', 'copy']
}

function audioEncodeArgs(budget: Pick<EncodingBudget, 'audioBitrate' | 'enhancedAudioBitrate'>, audioProfile: AudioProfile) {
  const surroundAudio = audioProfile === 'surround_5_1' || audioProfile === 'surround_5_1_aggressive'
  const args = [
    '-c:a', 'aac',
    '-b:a', surroundAudio ? budget.enhancedAudioBitrate : budget.audioBitrate,
    '-ar', '48000',
  ]

  const filters = ['asetpts=PTS-STARTPTS']
  if (audioProfile === 'surround_5_1_aggressive') {
    args.push('-ac', '6')
    filters.unshift(AUDIO_FILTERS.surroundAggressive)
  } else if (audioProfile === 'surround_5_1') {
    args.push('-ac', '6')
    filters.unshift(AUDIO_FILTERS.surroundSafe)
  } else if (audioProfile === 'standard') {
    filters.unshift(AUDIO_FILTERS.lightNormalize)
  } else if (audioProfile === 'loudnorm') {
    filters.unshift(AUDIO_FILTERS.loudnorm)
  }

  args.push('-af', filters.join(','))
  return args
}

export function encoderForBackend(backend: TranscodeBackend) {
  switch (backend) {
    case 'vaapi':
      return 'h264_vaapi'
    case 'videotoolbox':
      return 'h264_videotoolbox'
    case 'qsv':
      return 'h264_qsv'
    case 'amf':
      return 'h264_amf'
    case 'cpu':
      return 'libx264'
  }
}

export function probeFormatForBackend(backend: Exclude<TranscodeBackend, 'cpu'>) {
  return backend === 'videotoolbox' ? 'format=yuv420p' : 'format=nv12'
}

export function vaapiDeviceArgs(device: string | null) {
  return device ? ['-vaapi_device', device] : []
}

export function qsvDeviceArgs(device: string | null, platform = process.platform) {
  if (!device) return []

  if (platform === 'linux') {
    return [
      '-init_hw_device', `vaapi=va:${device}`,
      '-init_hw_device', 'qsv=qsv@va',
      '-filter_hw_device', 'qsv',
    ]
  }

  return ['-init_hw_device', `qsv=qsv:${device}`, '-filter_hw_device', 'qsv']
}

export function mpegtsArgs() {
  return [
    '-flush_packets', '1',
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-mpegts_flags', 'resend_headers',
    '-f', 'mpegts',
    '-fflags', '+genpts',
    'pipe:1',
  ]
}

export function profileArgs(profile: PlaybackProfile, backend: TranscodeBackend, options: ProfileArgsOptions = {}) {
  const streamMap = { videoInputIndex: options.videoInputIndex, audioInputIndex: options.audioInputIndex }
  const audioProfile = normalizeAudioProfile(options.audioProfile)

  switch (profile) {
    case 'stable_mpegts':
      return [
        ...streamMapArgs(streamMap),
        '-c:v', 'copy',
        ...audioEncodeArgs(ENCODING_BUDGETS.mpegtsRemuxAudio, audioProfile),
      ]
    case 'upscale_1080p':
      return [
        ...streamMapArgs(streamMap),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-vf', 'scale=-2:1080',
        ...audioEncodeArgs(ENCODING_BUDGETS.mpegtsRemuxAudio, audioProfile),
      ]
    case 'upscale_1080p_v2':
      return [
        ...streamMapArgs(streamMap),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '16',
        '-vf', 'scale=-2:1080:flags=lanczos,unsharp=3:3:0.5',
        ...audioEncodeArgs(ENCODING_BUDGETS.mpegtsRemuxAudio, audioProfile),
      ]
    case 'upscale_4k':
      return [
        ...streamMapArgs(streamMap),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '16',
        '-vf', 'scale=-2:2160:flags=bicubic',
        ...audioEncodeArgs(ENCODING_BUDGETS.mpegtsRemuxAudio, audioProfile),
      ]
    case 'upscale_1080p_hw': {
      if (backend === 'cpu') {
        return [
          ...streamMapArgs(streamMap),
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '16',
          '-vf', 'scale=-2:1080:flags=lanczos,unsharp=3:3:0.5',
          ...audioEncodeArgs(ENCODING_BUDGETS.mpegtsRemuxAudio, audioProfile),
        ]
      }
      const fmt = probeFormatForBackend(backend)
      const needsHwupload = backend === 'vaapi' || backend === 'qsv'
      const vf = `scale=-2:1080:flags=lanczos,unsharp=3:3:0.5,${fmt}${needsHwupload ? ',hwupload' : ''}`
      const rateArgs = backend === 'vaapi' ? ['-qp', '20'] : ['-b:v', '7000k']
      return [
        ...streamMapArgs(streamMap),
        '-c:v', encoderForBackend(backend),
        ...rateArgs,
        '-vf', vf,
        ...audioEncodeArgs(ENCODING_BUDGETS.mpegtsRemuxAudio, audioProfile),
      ]
    }
    case 'direct':
    case 'proxy':
      return [...streamMapArgs(streamMap), '-c', 'copy']
    default: {
      const _exhaustive: never = profile
      throw new Error(`Unhandled profile: ${_exhaustive}`)
    }
  }
}
