'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import type Mpegts from 'mpegts.js'
import { normalizePlaybackProfile, PROXY_PROFILES, type PlaybackProfile } from '@/lib/playback-profile'

interface Props {
  url: string
  title: string
  channelId: number
  playlistId?: number
  bufferSize?: string
  playbackProfile?: string | null
  transcodeBackend?: string | null
  proxyStreams?: boolean
  initialFavorite?: boolean
  onClose: () => void
  onToggleFavorite?: (isFavorite: boolean) => void
}

interface EpgData {
  title: string
  desc: string
  start: string
  stop: string
}

interface PlaybackStats {
  width: number | null
  height: number | null
  fps: number | null
}

interface TranscodeStats {
  cpuPercent: number | null
  memoryPercent: number | null
  backend: string | null
}

const BACKENDS = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'vaapi', label: 'VAAPI (Intel/AMD)' },
  { value: 'qsv', label: 'Intel QSV' },
  { value: 'videotoolbox', label: 'VideoToolbox (Mac)' },
  { value: 'amf', label: 'AMD AMF' },
  { value: 'cpu', label: 'Force CPU' },
]

function playbackModeLabel(playbackProfile: string | null | undefined, proxyStreams: boolean | undefined) {
  const profile = playbackProfile || (proxyStreams ? 'proxy' : 'direct')
  if (profile === 'direct' && proxyStreams) return 'Proxy: Proxy passthrough'
  if (profile === 'direct') return 'Direct'
  const label = PROXY_PROFILES.find(p => p.value === profile)?.label ?? profile
  return `Proxy: ${label}`
}

function isBenignMediaAbort(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message.includes('media resource was aborted by the user agent') || message.includes('aborted by the user agent')
}

function toBrowserAbsoluteUrl(url: string) {
  if (typeof window === 'undefined') return url
  return new URL(url, window.location.origin).toString()
}

function playbackUrlForProfile(channelId: number) {
  return `/api/stream/${channelId}`
}

function cacheBustUrl(url: string, version: number) {
  if (typeof window === 'undefined') return url
  const nextUrl = new URL(url, window.location.origin)
  nextUrl.searchParams.set('v', String(version))
  return nextUrl.origin === window.location.origin ? `${nextUrl.pathname}${nextUrl.search}` : nextUrl.toString()
}

function mpegtsStashSize(bufferSize: string) {
  switch (bufferSize) {
    case 'small':
      return 384 * 1024
    case 'large':
      return 2 * 1024 * 1024
    case 'medium':
    default:
      return 1024 * 1024
  }
}

export default function ChannelPlayer({ url, title, channelId, playlistId, bufferSize = 'medium', playbackProfile, transcodeBackend, proxyStreams, initialFavorite, onClose, onToggleFavorite }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFavorite, setIsFavorite] = useState(!!initialFavorite)
  const [epg, setEpg] = useState<EpgData | null>(null)
  const [loadingEpg, setLoadingEpg] = useState(false)
  const [isCasting, setIsCasting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [activeProfile, setActiveProfile] = useState(normalizePlaybackProfile(playbackProfile || 'proxy'))
  const [activeBackend, setActiveBackend] = useState(transcodeBackend || 'auto')
  const [streamUrl, setStreamUrl] = useState(url)
  const [playbackStats, setPlaybackStats] = useState<PlaybackStats>({ width: null, height: null, fps: null })
  const [transcodeStats, setTranscodeStats] = useState<TranscodeStats | null>(null)
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null)
  const [isStoppingTranscode, setIsStoppingTranscode] = useState(false)
  const [transcodeStopped, setTranscodeStopped] = useState(false)
  const playerRef = useRef<Mpegts.Player | null>(null)
  const retryCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameStatsRef = useRef({ frames: 0, startedAt: 0 })
  const versionRef = useRef(0)
  const transcodeStopRequestedRef = useRef(false)
  const modeLabel = playbackModeLabel(activeProfile, proxyStreams)
  const isTranscodedStream = activeProfile !== 'direct' && activeProfile !== 'proxy'

  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (isBenignMediaAbort(event.reason)) event.preventDefault()
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }, [])

  useEffect(() => {
    // Listen for Cast state changes
    if (typeof window !== 'undefined') {
      const win = window as any
      if (win.cast?.framework) {
        const cast = win.cast
        const context = cast.framework.CastContext.getInstance()
        const handler = (event: { value: string }) => {
          setIsCasting(event.value === cast.framework.CastState.CONNECTED)
        }
        context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, handler)
        
        // Defer to avoid cascading render warning
        const isConnected = context.getCastState() === cast.framework.CastState.CONNECTED
        if (isConnected) {
          setTimeout(() => setIsCasting(true), 0)
        }

        return () => context.removeEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, handler)
      }
    }
  }, [])

  useEffect(() => {
    // If cast is available and connected, load media
    if (isCasting && typeof window !== 'undefined') {
      const win = window as any
      if (win.cast?.framework && win.chrome?.cast?.media) {
        const cast = win.cast
        const chrome = win.chrome
        const context = cast.framework.CastContext.getInstance()
        const session = context.getCurrentSession()
        
        if (session) {
          const absoluteUrl = new URL(url, win.location.origin).toString()
          const mediaInfo = new chrome.cast.media.MediaInfo(absoluteUrl, 'video/mp2t')
          
          const metadata = new chrome.cast.media.GenericMediaMetadata()
          metadata.title = title
          if (epg) {
            metadata.subtitle = epg.title
          }
          mediaInfo.metadata = metadata

          const request = new chrome.cast.media.LoadRequest(mediaInfo)
          session.loadMedia(request).catch((err: unknown) => console.error('Cast load error', err))
          
          // Pause local video when casting
          if (videoRef.current) videoRef.current.pause()
        }
      }
    }
  }, [url, title, epg, isCasting])

  useEffect(() => {
    async function fetchEpg() {
      setLoadingEpg(true)
      try {
        const res = await fetch(`/api/channels/${channelId}/epg`)
        if (res.ok) {
          const data = await res.json()
          setEpg(data)
        } else {
          setEpg(null)
        }
      } catch {
        setEpg(null)
      } finally {
        setLoadingEpg(false)
      }
    }
    fetchEpg()
  }, [channelId])

  async function toggleFavorite() {
    const newVal = !isFavorite
    setIsFavorite(newVal)
    try {
      await fetch(`/api/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: newVal }),
      })
      onToggleFavorite?.(newVal)
    } catch (err) {
      console.error('Failed to toggle favorite', err)
      setIsFavorite(!newVal)
    }
  }

  async function updateSettings(newProfile?: PlaybackProfile, newBackend?: string) {
    if (!playlistId) return
    
    const profile = newProfile ?? activeProfile
    const backend = newBackend ?? activeBackend

    try {
      await fetch(`/api/playlists/${playlistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          playbackProfile: profile,
          transcodeBackend: backend,
          proxyStreams: profile !== 'direct',
        }),
      })

      if (newProfile) setActiveProfile(profile)
      if (newBackend) setActiveBackend(backend)
      
      // Reload stream - force a refresh by adding a version parameter
      versionRef.current += 1
      transcodeStopRequestedRef.current = false
      setTranscodeStopped(false)
      setStreamUrl(cacheBustUrl(playbackUrlForProfile(channelId), versionRef.current))
      setShowSettings(false)
    } catch (err) {
      console.error('Failed to update playlist settings', err)
    }
  }

  async function stopTranscoding() {
    if (isStoppingTranscode) return

    transcodeStopRequestedRef.current = true
    setIsStoppingTranscode(true)
    setError(null)

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    if (playerRef.current) {
      try {
        playerRef.current.unload()
      } catch {
        // Ignore teardown races inside mpegts.js.
      }
      try {
        playerRef.current.detachMediaElement()
      } catch {
        // Ignore teardown races inside mpegts.js.
      }
      try {
        playerRef.current.destroy()
      } catch {
        // Ignore teardown races inside mpegts.js.
      }
      playerRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.pause()
    }

    setTranscodeStats(null)
    setTranscodeStopped(true)
    setIsStoppingTranscode(false)
  }

  useEffect(() => {
    if (!isTranscodedStream) {
      const resetTimer = setTimeout(() => setTranscodeStats(null), 0)
      return () => clearTimeout(resetTimer)
    }

    let cancelled = false

    async function fetchTranscodeStats() {
      try {
        const res = await fetch('/api/transcode/status', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as {
          sessions?: Array<{
            channelId: number
            cpuPercent: number | null
            memoryPercent: number | null
            backend: string | null
            running: boolean
          }>
        }
        const session = data.sessions?.find(item => item.channelId === channelId && item.running)
        if (!cancelled) {
          setTranscodeStats(session
            ? {
                cpuPercent: session.cpuPercent,
                memoryPercent: session.memoryPercent,
                backend: session.backend,
              }
            : null)
        }
      } catch {
        if (!cancelled) setTranscodeStats(null)
      }
    }

    fetchTranscodeStats()
    const timer = setInterval(fetchTranscodeStats, 2500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [channelId, isTranscodedStream, streamUrl])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const media = video

    transcodeStopRequestedRef.current = false
    setTranscodeStopped(false)
    setError(null)
    setReconnectMessage(null)
    setPlaybackStats({ width: null, height: null, fps: null })
    frameStatsRef.current = { frames: 0, startedAt: 0 }
    retryCountRef.current = 0
    let frameCallbackId: number | null = null
    let cancelled = false

    function updateResolution() {
      setPlaybackStats(current => ({
        ...current,
        width: media.videoWidth || null,
        height: media.videoHeight || null,
      }))
    }

    function clearReconnectMessage() {
      setReconnectMessage(null)
    }

    function suppressStartupStallJump(event: Event) {
      if (media.currentTime < 1 && media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        event.stopImmediatePropagation()
      }
    }

    function updateFrameRate(now: DOMHighResTimeStamp) {
      const stats = frameStatsRef.current
      if (!stats.startedAt) stats.startedAt = now
      stats.frames += 1

      const elapsed = now - stats.startedAt
      if (elapsed >= 1500) {
        const fps = stats.frames / (elapsed / 1000)
        setPlaybackStats(current => ({ ...current, fps }))
        stats.frames = 0
        stats.startedAt = now
      }

      if ('requestVideoFrameCallback' in media) {
        frameCallbackId = media.requestVideoFrameCallback(updateFrameRate)
      }
    }

    media.addEventListener('loadedmetadata', updateResolution)
    media.addEventListener('loadedmetadata', clearReconnectMessage)
    media.addEventListener('progress', suppressStartupStallJump, true)
    media.addEventListener('stalled', suppressStartupStallJump, true)
    media.addEventListener('resize', updateResolution)
    if ('requestVideoFrameCallback' in media) {
      frameCallbackId = media.requestVideoFrameCallback(updateFrameRate)
    }

    function scheduleReconnect(message: string) {
      if (transcodeStopRequestedRef.current) return
      setReconnectMessage(message)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(() => {
        retryCountRef.current += 1
        versionRef.current += 1
        setStreamUrl(current => cacheBustUrl(current, versionRef.current))
      }, Math.min(1000 * Math.pow(2, retryCountRef.current), 30000))
    }

    async function startMpegtsPlayer() {
      const mpegts = (await import('mpegts.js')).default
      if (cancelled) return

      if (!mpegts.getFeatureList().mseLivePlayback) {
        setTimeout(() => {
          if (!cancelled) setError('Your browser does not support MPEG-TS playback (MSE required)')
        }, 0)
        return
      }

      const player = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: toBrowserAbsoluteUrl(streamUrl),
      }, {
        enableWorker: false,
        enableStashBuffer: true,
        stashInitialSize: mpegtsStashSize(bufferSize),
        lazyLoad: false,
        liveBufferLatencyChasing: false,
        liveSync: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 90,
        autoCleanupMinBackwardDuration: 30,
        fixAudioTimestampGap: true,
      })
      if (cancelled) {
        player.destroy()
        return
      }

      playerRef.current = player
      player.attachMediaElement(media)
      player.load()
      const playResult = player.play()
      if (playResult) {
        playResult.catch((err: unknown) => {
          if (!isBenignMediaAbort(err)) console.error('mpegts play error', err)
        })
      }

      player.on(mpegts.Events.ERROR, (type, detail) => {
        scheduleReconnect(`Playback error: ${type} - ${detail}. Reconnecting...`)
      })

      player.on(mpegts.Events.LOADING_COMPLETE, () => {
        scheduleReconnect('Stream ended. Reconnecting...')
      })

      player.on(mpegts.Events.RECOVERED_EARLY_EOF, () => {
        console.info('mpegts recovered early EOF')
      })

      player.on(mpegts.Events.STATISTICS_INFO, (stats) => {
        if (stats.speed && stats.speed < 0.9) {
          console.warn('mpegts low download speed', stats)
        }
      })
    }

    void startMpegtsPlayer()

    return () => {
      cancelled = true
      media.removeEventListener('loadedmetadata', updateResolution)
      media.removeEventListener('loadedmetadata', clearReconnectMessage)
      media.removeEventListener('progress', suppressStartupStallJump, true)
      media.removeEventListener('stalled', suppressStartupStallJump, true)
      media.removeEventListener('resize', updateResolution)
      if (frameCallbackId !== null && 'cancelVideoFrameCallback' in media) {
        media.cancelVideoFrameCallback(frameCallbackId)
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (playerRef.current) {
        try {
          playerRef.current.unload()
        } catch {
          // Ignore teardown races inside mpegts.js.
        }
        try {
          playerRef.current.detachMediaElement()
        } catch {
          // Ignore teardown races inside mpegts.js.
        }
        try {
          playerRef.current.destroy()
        } catch {
          // Ignore teardown races inside mpegts.js.
        }
        playerRef.current = null
      }
    }
  }, [streamUrl, bufferSize, channelId])

  return (
    <div className="flex flex-col h-full bg-black text-white overflow-hidden rounded-lg shadow-xl border border-gray-800">
      <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800">
        <div className="min-w-0 flex-1 pr-4">
          <h2 className="text-sm font-medium truncate">{title}</h2>
          {(playbackStats.width && playbackStats.height) || playbackStats.fps ? (
            <p className="mt-0.5 text-[11px] text-gray-400">
              {modeLabel}
              {' • '}
              {playbackStats.width && playbackStats.height ? `${playbackStats.width}x${playbackStats.height}` : 'Resolution pending'}
              {playbackStats.fps ? ` • ${playbackStats.fps.toFixed(playbackStats.fps >= 50 ? 0 : 2)} fps` : ' • FPS pending'}
              {transcodeStats ? ` • CPU ${transcodeStats.cpuPercent === null ? 'n/a' : `${transcodeStats.cpuPercent.toFixed(0)}%`} • GPU ${transcodeStats.backend ?? 'n/a'}` : ''}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-gray-400">
              {modeLabel}
              {transcodeStats ? ` • CPU ${transcodeStats.cpuPercent === null ? 'n/a' : `${transcodeStats.cpuPercent.toFixed(0)}%`} • GPU ${transcodeStats.backend ?? 'n/a'}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <style jsx global>{`
            google-cast-launcher {
              --connected-color: #3b82f6;
              --disconnected-color: #9ca3af;
              width: 20px;
              height: 20px;
              cursor: pointer;
            }
          `}</style>
          
          <div className="relative">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1 rounded hover:bg-gray-800 transition-colors ${showSettings ? 'text-blue-500' : 'text-gray-400 hover:text-white'}`}
              title="Stream Settings"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {showSettings && (
              <div className="absolute right-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-[60] p-3 space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 mb-2 tracking-wider">Playback Profile</label>
                  <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto pr-1">
                    {PROXY_PROFILES.map(p => (
                      <button
                        key={p.value}
                        onClick={() => updateSettings(p.value)}
                        className={`text-left px-2 py-1.5 rounded text-xs transition-colors ${activeProfile === p.value ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-300'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {isTranscodedStream && !PROXY_PROFILES.find(p => p.value === activeProfile)?.cpuOnly && (
                  <div className="pt-3 border-t border-gray-800">
                    <label className="block text-[10px] uppercase font-bold text-gray-500 mb-2 tracking-wider">Hardware Backend</label>
                    <div className="grid grid-cols-1 gap-1">
                      {BACKENDS.map(b => (
                        <button
                          key={b.value}
                          onClick={() => updateSettings(undefined, b.value)}
                          className={`text-left px-2 py-1.5 rounded text-xs transition-colors ${activeBackend === b.value ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-300'}`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {isTranscodedStream && (
            <button
              onClick={stopTranscoding}
              disabled={isStoppingTranscode || transcodeStopped}
              className={`p-1 rounded transition-colors ${
                isStoppingTranscode || transcodeStopped
                  ? 'text-gray-600 cursor-not-allowed'
                  : 'text-red-400 hover:text-red-300 hover:bg-red-950/50'
              }`}
              title={transcodeStopped ? 'Transcoding stopped' : 'Stop transcoding'}
              aria-label={transcodeStopped ? 'Transcoding stopped' : 'Stop transcoding'}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7h10v10H7z" />
              </svg>
            </button>
          )}

          {/* @ts-expect-error google-cast-launcher is a custom element from Cast SDK */}
          <google-cast-launcher />
          <button onClick={toggleFavorite} className={`transition-colors ${isFavorite ? 'text-yellow-500 hover:text-yellow-400' : 'text-gray-400 hover:text-white'}`} title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}>
            <svg className="w-5 h-5" fill={isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="relative flex-1 flex items-center justify-center bg-black">
        {isCasting ? (
          <div className="text-center p-6">
            <svg className="w-16 h-16 mx-auto mb-4 text-blue-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-lg font-medium">Casting to device...</p>
            <p className="text-sm text-gray-400 mt-1 italic">Playback continues on your external screen</p>
          </div>
        ) : transcodeStopped ? (
          <div className="p-6 text-center text-gray-300">
            <svg className="w-12 h-12 mx-auto mb-4 text-red-400 opacity-80" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7h10v10H7z" />
            </svg>
            <p className="text-sm font-medium">Transcoding stopped</p>
            <p className="mt-1 text-xs text-gray-500">Change the playback profile or reopen the channel to start a new session.</p>
          </div>
        ) : error ? (
          <div data-testid="player-error" className="p-6 text-center text-red-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs transition-colors">Retry</button>
          </div>
        ) : (
          <>
            <video
              data-testid="channel-video"
              ref={videoRef}
              className="w-full h-full object-contain"
              controls
              autoPlay
              playsInline
            />
            {reconnectMessage && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/75 px-3 py-2 text-xs text-white shadow-lg">
                {reconnectMessage}
              </div>
            )}
          </>
        )}
      </div>

      <div className="p-4 bg-gray-900 border-t border-gray-800 flex-none min-h-[120px]">
        {loadingEpg ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-800 rounded w-3/4"></div>
            <div className="h-3 bg-gray-800 rounded w-1/2"></div>
            <div className="h-12 bg-gray-800 rounded w-full"></div>
          </div>
        ) : epg ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Now Playing</span>
              <span className="text-[10px] text-gray-500 font-mono">
                {new Date(epg.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(epg.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <h3 className="text-sm font-bold leading-tight">{epg.title}</h3>
            {epg.desc && (
              <p className="text-xs text-gray-400 line-clamp-3 leading-normal">{epg.desc}</p>
            )}
            
            {/* Progress Bar */}
            <div className="pt-1">
              <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-1000"
                  style={{ 
                    width: `${Math.max(0, Math.min(100, 
                      ((new Date().getTime() - new Date(epg.start).getTime()) / 
                      (new Date(epg.stop).getTime() - new Date(epg.start).getTime())) * 100
                    ))}%` 
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-xs italic">
            No EPG information available
          </div>
        )}
      </div>
    </div>
  )
}
