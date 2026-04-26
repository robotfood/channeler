'use client'

import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

interface Props {
  url: string
  title: string
  channelId: number
  onClose: () => void
}

interface EpgData {
  title: string
  desc: string
  start: string
  stop: string
}

export default function ChannelPlayer({ url, title, channelId, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [epg, setEpg] = useState<EpgData | null>(null)
  const [loadingEpg, setLoadingEpg] = useState(false)
  const hlsRef = useRef<Hls | null>(null)

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

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    setError(null)

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      })
      hlsRef.current = hls
      hls.loadSource(url)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setError('Network error - check your stream URL or proxy settings')
              hls.startLoad()
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              setError('Media error - trying to recover...')
              hls.recoverMediaError()
              break
            default:
              setError(`Fatal playback error: ${data.details}`)
              hls.destroy()
              break
          }
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari/iOS)
      video.src = url
    } else {
      setError('Your browser does not support HLS playback')
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [url])

  return (
    <div className="flex flex-col h-full bg-black text-white overflow-hidden rounded-lg shadow-xl border border-gray-800">
      <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800">
        <h2 className="text-sm font-medium truncate flex-1 pr-4">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="relative flex-1 flex items-center justify-center bg-black">
        {error ? (
          <div className="p-6 text-center text-red-400">
            <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs transition-colors">Retry</button>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            autoPlay
            playsInline
          />
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
