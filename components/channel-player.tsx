'use client'

import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

interface Props {
  url: string
  title: string
  onClose: () => void
}

export default function ChannelPlayer({ url, title, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const hlsRef = useRef<Hls | null>(null)

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
    </div>
  )
}
