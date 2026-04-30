import path from 'node:path'
import { normalizeAudioProfile, type AudioProfile } from '@/lib/audio-profile'

export const TRANSCODE_BACKENDS = ['vaapi', 'qsv', 'amf', 'videotoolbox', 'cpu'] as const
export type TranscodeBackend = typeof TRANSCODE_BACKENDS[number]

type StreamMap = {
  videoInputIndex?: number
  audioInputIndex?: number
}

type ProfileArgsOptions = StreamMap & {
  audioProfile?: string | null
  unknownProfile?: 'copy' | 'throw'
}

type EncodingBudget = {
  videoBitrate: string
  maxrate: string
  bufsize: string
  audioBitrate: string
  enhancedAudioBitrate: string
}

const ENCODING_BUDGETS = {
  stableHlsAudio: { audioBitrate: '192k', enhancedAudioBitrate: '384k' },
  transcode720p: { videoBitrate: '3500k', maxrate: '4200k', bufsize: '7000k', audioBitrate: '192k', enhancedAudioBitrate: '384k' },
  transcode1080p: { videoBitrate: '6000k', maxrate: '7200k', bufsize: '12000k', audioBitrate: '192k', enhancedAudioBitrate: '512k' },
  transcode4k: { videoBitrate: '22000k', maxrate: '28000k', bufsize: '44000k', audioBitrate: '256k', enhancedAudioBitrate: '640k' },
  enhanced1080p: { videoBitrate: '6500k', maxrate: '8000k', bufsize: '13000k', audioBitrate: '192k', enhancedAudioBitrate: '512k' },
  clean1080p: { videoBitrate: '6000k', maxrate: '7500k', bufsize: '12000k', audioBitrate: '192k', enhancedAudioBitrate: '512k' },
  smooth720p60Hardware: { videoBitrate: '5000k', maxrate: '6000k', bufsize: '10000k', audioBitrate: '192k', enhancedAudioBitrate: '384k' },
  smooth720p60Software: { videoBitrate: '4500k', maxrate: '5500k', bufsize: '9000k', audioBitrate: '192k', enhancedAudioBitrate: '384k' },
  smooth1080p60Hardware: { videoBitrate: '8500k', maxrate: '10000k', bufsize: '17000k', audioBitrate: '192k', enhancedAudioBitrate: '512k' },
  smooth1080p60Software: { videoBitrate: '7500k', maxrate: '9000k', bufsize: '15000k', audioBitrate: '192k', enhancedAudioBitrate: '512k' },
  sports720p60: { videoBitrate: '5500k', maxrate: '7000k', bufsize: '11000k', audioBitrate: '192k', enhancedAudioBitrate: '384k' },
} as const

const FPS = {
  broadcast: 30,
  smooth: 60,
} as const

const AUDIO_FILTERS = {
  lightNormalize: 'dynaudnorm=f=120:g=8:p=0.96',
  surroundSafe: 'aformat=channel_layouts=stereo,dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1',
  surroundAggressive: 'aformat=channel_layouts=stereo,dynaudnorm=f=150:g=15:p=0.9,surround=chl_out=5.1:focus=0.8:angle=65:smooth=0.2:level_out=1.15:lfe_mode=add:lfe_low=80:lfe_high=180',
} as const

function streamMapArgs({ videoInputIndex = 0, audioInputIndex = 0 }: StreamMap = {}) {
  return ['-map', `${videoInputIndex}:v:0?`, '-map', `${audioInputIndex}:a:0?`]
}

function audioEncodeArgs(budget: Pick<EncodingBudget, 'audioBitrate' | 'enhancedAudioBitrate'>, audioProfile: AudioProfile) {
  const surroundAudio = audioProfile === 'surround_5_1' || audioProfile === 'surround_5_1_aggressive'
  const args = [
    '-c:a', 'aac',
    '-b:a', surroundAudio ? budget.enhancedAudioBitrate : budget.audioBitrate,
    '-ar', '48000',
  ]

  if (audioProfile === 'surround_5_1_aggressive') {
    args.push('-ac', '6', '-af', AUDIO_FILTERS.surroundAggressive)
  } else if (audioProfile === 'surround_5_1') {
    args.push('-ac', '6', '-af', AUDIO_FILTERS.surroundSafe)
  } else if (audioProfile === 'standard') {
    args.push('-af', AUDIO_FILTERS.lightNormalize)
  }

  return args
}

function bitrateArgs(videoBitrate: string, maxrate: string, bufsize: string) {
  return ['-b:v', videoBitrate, '-maxrate', maxrate, '-bufsize', bufsize]
}

function h264HlsCompatibilityArgs() {
  return ['-bsf:v', 'dump_extra']
}

function forcedKeyFrameArgs() {
  return ['-force_key_frames', 'expr:gte(t,n_forced*2)']
}

function fpsArgs(fps?: number) {
  return fps ? ['-r', String(fps), '-g', String(fps * 2), '-keyint_min', String(fps * 2)] : []
}

function maxHeightScaleFilter(height: number, scaleFlags = 'lanczos') {
  return `scale=-2:'max(ih\\,${height})':flags=${scaleFlags}`
}

function videoToolboxFilter(filter: string) {
  return filter.includes('yadif')
    ? filter.replace(/yadif=[^,]+/, 'yadif_videotoolbox=mode=send_field')
    : filter
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

export function hlsArgs(outputDir: string, segmentTime = 2) {
  return [
    '-f', 'hls',
    '-hls_time', String(segmentTime),
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+independent_segments+omit_endlist+program_date_time',
    '-hls_segment_filename', path.join(outputDir, 'segment_%06d.ts'),
    path.join(outputDir, 'index.m3u8'),
  ]
}

function cpuH264Args(height: number, budget: EncodingBudget, audioProfile: AudioProfile, streamMap?: StreamMap) {
  return [
    ...streamMapArgs(streamMap),
    // Use max(ih, height) to upscale low-res but never downscale high-res.
    // The comma in max() must be escaped because it is inside a filter chain.
    '-vf', `${maxHeightScaleFilter(height)},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    ...h264HlsCompatibilityArgs(),
    ...forcedKeyFrameArgs(),
    '-sc_threshold', '0',
    ...bitrateArgs(budget.videoBitrate, budget.maxrate, budget.bufsize),
    ...audioEncodeArgs(budget, audioProfile),
  ]
}

function hardwareH264Args(
  backend: TranscodeBackend,
  height: number,
  budget: EncodingBudget,
  audioProfile: AudioProfile,
  scaleFlags = 'lanczos',
  streamMap?: StreamMap
) {
  if (backend === 'cpu') return cpuH264Args(height, budget, audioProfile, streamMap)

  if (backend === 'vaapi') {
    return [
      ...streamMapArgs(streamMap),
      '-vf', height >= 2160
        ? `hwupload,scale_vaapi=w=-2:h=${height}:format=nv12`
        : `${maxHeightScaleFilter(height, scaleFlags)},format=nv12,hwupload`,
      '-c:v', encoderForBackend(backend),
      ...h264HlsCompatibilityArgs(),
      ...forcedKeyFrameArgs(),
      '-qp', height >= 2160 ? '18' : height >= 1080 ? '21' : '23',
      ...audioEncodeArgs(budget, audioProfile),
    ]
  }

  if (backend === 'videotoolbox') {
    return [
      ...streamMapArgs(streamMap),
      '-vf', `${maxHeightScaleFilter(height, scaleFlags)},format=yuv420p`,
      '-c:v', encoderForBackend(backend),
      '-realtime', 'true',
      ...h264HlsCompatibilityArgs(),
      ...forcedKeyFrameArgs(),
      ...bitrateArgs(budget.videoBitrate, budget.maxrate, budget.bufsize),
      ...audioEncodeArgs(budget, audioProfile),
    ]
  }

  if (backend === 'amf') {
    return [
      ...streamMapArgs(streamMap),
      '-vf', `${maxHeightScaleFilter(height, scaleFlags)},format=nv12`,
      '-c:v', encoderForBackend(backend),
      '-quality', 'speed',
      ...h264HlsCompatibilityArgs(),
      ...forcedKeyFrameArgs(),
      ...bitrateArgs(budget.videoBitrate, budget.maxrate, budget.bufsize),
      ...audioEncodeArgs(budget, audioProfile),
    ]
  }

  return [
    ...streamMapArgs(streamMap),
    '-vf', height >= 2160
      ? `format=nv12,vpp_qsv=w=-2:h=${height}`
      : `${maxHeightScaleFilter(height, scaleFlags)},format=nv12`,
    '-c:v', encoderForBackend(backend),
    '-preset', 'veryfast',
    ...h264HlsCompatibilityArgs(),
    ...forcedKeyFrameArgs(),
    ...bitrateArgs(budget.videoBitrate, budget.maxrate, budget.bufsize),
    ...audioEncodeArgs(budget, audioProfile),
  ]
}

function hardwareFilteredH264Args(
  backend: TranscodeBackend,
  filter: string,
  budget: EncodingBudget,
  audioProfile: AudioProfile,
  fps?: number,
  streamMap?: StreamMap
) {
  if (backend === 'cpu') {
    return [
      ...streamMapArgs(streamMap),
      '-vf', `${filter},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      ...h264HlsCompatibilityArgs(),
      ...fpsArgs(fps),
      ...forcedKeyFrameArgs(),
      '-sc_threshold', '0',
      ...bitrateArgs(budget.videoBitrate, budget.maxrate, budget.bufsize),
      ...audioEncodeArgs(budget, audioProfile),
    ]
  }

  if (backend === 'vaapi') {
    return [
      ...streamMapArgs(streamMap),
      '-vf', filter.includes('hwupload') ? filter : `${filter},format=nv12,hwupload`,
      '-c:v', encoderForBackend(backend),
      ...h264HlsCompatibilityArgs(),
      ...fpsArgs(fps),
      ...forcedKeyFrameArgs(),
      '-qp', '23',
      ...audioEncodeArgs(budget, audioProfile),
    ]
  }

  if (backend === 'videotoolbox') {
    return [
      ...streamMapArgs(streamMap),
      '-vf', videoToolboxFilter(filter),
      '-c:v', encoderForBackend(backend),
      ...h264HlsCompatibilityArgs(),
      ...fpsArgs(fps),
      ...forcedKeyFrameArgs(),
      ...bitrateArgs(budget.videoBitrate, budget.maxrate, budget.bufsize),
      ...audioEncodeArgs(budget, audioProfile),
    ]
  }

  return [
    ...streamMapArgs(streamMap),
    '-vf', filter.includes('format=nv12') ? filter : `${filter},format=nv12`,
    '-c:v', encoderForBackend(backend),
    ...(backend === 'qsv' ? ['-preset', 'veryfast'] : ['-quality', 'speed']),
    ...h264HlsCompatibilityArgs(),
    ...fpsArgs(fps),
    ...forcedKeyFrameArgs(),
    ...bitrateArgs(budget.videoBitrate, budget.maxrate, budget.bufsize),
    ...audioEncodeArgs(budget, audioProfile),
  ]
}

export function profileArgs(profile: string, backend: TranscodeBackend, options: ProfileArgsOptions = {}) {
  const streamMap = { videoInputIndex: options.videoInputIndex, audioInputIndex: options.audioInputIndex }
  const audioProfile = normalizeAudioProfile(options.audioProfile)

  switch (profile) {
    case 'stable_hls':
      return [
        ...streamMapArgs(streamMap),
        '-c:v', 'copy',
        ...audioEncodeArgs(ENCODING_BUDGETS.stableHlsAudio, audioProfile),
      ]
    case 'transcode_720p':
      return hardwareH264Args(backend, 720, ENCODING_BUDGETS.transcode720p, audioProfile, 'lanczos', streamMap)
    case 'transcode_1080p':
      return hardwareH264Args(backend, 1080, ENCODING_BUDGETS.transcode1080p, audioProfile, 'lanczos', streamMap)
    case 'transcode_4k':
      return hardwareH264Args(backend, 2160, ENCODING_BUDGETS.transcode4k, audioProfile, 'lanczos', streamMap)
    case 'enhanced_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=0:parity=auto:deint=interlaced,scale=-2:\'max(ih\\,1080)\':flags=lanczos,unsharp=5:5:0.45:3:3:0.25',
        ENCODING_BUDGETS.enhanced1080p,
        audioProfile,
        FPS.broadcast,
        streamMap
      )
    case 'clean_1080p':
      return hardwareFilteredH264Args(
        backend,
        'yadif=mode=0:parity=auto:deint=interlaced,hqdn3d=1.5:1.5:4:4,scale=-2:\'max(ih\\,1080)\':flags=lanczos,unsharp=3:3:0.25:3:3:0.12',
        ENCODING_BUDGETS.clean1080p,
        audioProfile,
        FPS.broadcast,
        streamMap
      )
    case 'smooth_720p60':
      if (backend === 'vaapi') return hardwareFilteredH264Args(backend, 'hwupload,deinterlace_vaapi,scale_vaapi=w=-2:h=720:format=nv12', ENCODING_BUDGETS.smooth720p60Hardware, audioProfile, FPS.smooth, streamMap)
      if (backend === 'qsv') return hardwareFilteredH264Args(backend, 'format=nv12,vpp_qsv=deinterlace=2:w=-2:h=720', ENCODING_BUDGETS.smooth720p60Hardware, audioProfile, FPS.smooth, streamMap)
      return hardwareFilteredH264Args(backend, 'yadif=mode=send_field:parity=auto:deint=interlaced,scale=-2:\'max(ih\\,720)\':flags=lanczos', ENCODING_BUDGETS.smooth720p60Software, audioProfile, FPS.smooth, streamMap)
    case 'smooth_1080p60':
      if (backend === 'vaapi') return hardwareFilteredH264Args(backend, 'hwupload,deinterlace_vaapi,scale_vaapi=w=-2:h=1080:format=nv12', ENCODING_BUDGETS.smooth1080p60Hardware, audioProfile, FPS.smooth, streamMap)
      if (backend === 'qsv') return hardwareFilteredH264Args(backend, 'format=nv12,vpp_qsv=deinterlace=2:w=-2:h=1080', ENCODING_BUDGETS.smooth1080p60Hardware, audioProfile, FPS.smooth, streamMap)
      return hardwareFilteredH264Args(backend, 'yadif=mode=send_field:parity=auto:deint=interlaced,scale=-2:\'max(ih\\,1080)\':flags=lanczos', ENCODING_BUDGETS.smooth1080p60Software, audioProfile, FPS.smooth, streamMap)
    case 'sports_720p60':
      if (backend === 'vaapi') return hardwareFilteredH264Args(backend, 'hwupload,deinterlace_vaapi,scale_vaapi=w=-2:h=720:format=nv12', ENCODING_BUDGETS.sports720p60, audioProfile, FPS.smooth, streamMap)
      if (backend === 'qsv') return hardwareFilteredH264Args(backend, 'format=nv12,vpp_qsv=deinterlace=2:w=-2:h=720:detail=50:denoise=20', ENCODING_BUDGETS.sports720p60, audioProfile, FPS.smooth, streamMap)
      return hardwareFilteredH264Args(backend, 'yadif=mode=send_field:parity=auto:deint=interlaced,scale=-2:\'max(ih\\,720)\':flags=lanczos,unsharp=5:5:0.35:3:3:0.2', ENCODING_BUDGETS.sports720p60, audioProfile, FPS.smooth, streamMap)
    default:
      if (options.unknownProfile === 'throw') throw new Error(`Unknown profile: ${profile}`)
      return [...streamMapArgs(streamMap), '-c', 'copy']
  }
}
