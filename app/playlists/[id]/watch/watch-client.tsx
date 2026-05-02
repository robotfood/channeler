'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import type { PlaylistData } from '@/lib/app-data'
import ChannelPlayer from '@/components/channel-player'
import { channelPlaybackUrl } from '@/lib/stream-url'

type Channel = PlaylistData['channels'][number]

export default function WatchClient({ initialData }: { initialData: PlaylistData }) {
  const [channels, setChannels] = useState(initialData.channels)
  const [selectedGroupId, setSelectedGroupId] = useState<number | 'favorites' | null>(
    initialData.groups.find(g => g.enabled)?.id ?? 'favorites'
  )
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null)
  const [groupEpg, setGroupEpg] = useState<Record<number, { title: string }>>({})
  const [channelSearch, setChannelSearch] = useState('')

  const enabledGroups = useMemo(() => initialData.groups.filter(g => g.enabled), [initialData.groups])
  
  const filteredChannels = useMemo(() => {
    if (!selectedGroupId) return []
    const list = selectedGroupId === 'favorites'
      ? channels.filter(c => c.isFavorite)
      : channels.filter(c => c.groupId === selectedGroupId)

    return list.filter(c => 
      c.enabled && 
      !c.isDeleted &&
      c.displayName.toLowerCase().includes(channelSearch.toLowerCase())
    )
  }, [channels, selectedGroupId, channelSearch])

  async function toggleFavorite(e: React.MouseEvent, channelId: number) {
    e.stopPropagation()
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    const newVal = !ch.isFavorite
    
    // Optimistic update
    setChannels(prev => prev.map(c => c.id === channelId ? { ...c, isFavorite: newVal } : c))
    if (playingChannel?.id === channelId) {
      setPlayingChannel({ ...playingChannel, isFavorite: newVal })
    }

    try {
      await fetch(`/api/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: newVal }),
      })
    } catch (err) {
      console.error('Failed to toggle favorite', err)
      // Rollback
      setChannels(prev => prev.map(c => c.id === channelId ? { ...c, isFavorite: newVal } : c))
    }
  }

  useEffect(() => {
    if (!selectedGroupId || selectedGroupId === 'favorites') return
    fetch(`/api/groups/${selectedGroupId}/epg`)
      .then(res => res.json())
      .then(setGroupEpg)
      .catch(() => {})
  }, [selectedGroupId])

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] w-full max-w-7xl flex-col">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm">← Back</Link>
          <h1 className="text-xl font-semibold">{initialData.name}</h1>
        </div>
      </div>

      <div className={`grid min-h-0 flex-1 gap-4 overflow-hidden transition-all duration-300 ${playingChannel ? 'grid-cols-[16rem_1fr_24rem]' : 'grid-cols-[18rem_minmax(0,1fr)]'}`}>
        {/* Categories */}
        <div className="min-h-0 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Categories</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <button
              onClick={() => setSelectedGroupId('favorites')}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center gap-2 ${selectedGroupId === 'favorites' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
            >
              <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
              Favourites
            </button>
            <div className="h-px bg-gray-100 dark:bg-gray-800 my-1 mx-2" />
            {enabledGroups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${selectedGroupId === g.id ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
              >
                {g.displayName}
              </button>
            ))}
          </div>
        </div>

        {/* Channels */}
        <div className="min-h-0 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
            <input
              value={channelSearch}
              onChange={e => setChannelSearch(e.target.value)}
              placeholder="Search channels..."
              className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredChannels.map(ch => (
              <div
                key={ch.id}
                data-testid="channel-row"
                onClick={() => setPlayingChannel(ch)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors group text-left cursor-pointer ${playingChannel?.id === ch.id ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800/50' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <div className="relative w-10 h-8 shrink-0 flex items-center justify-center bg-gray-900 rounded overflow-hidden">
                  {ch.tvgLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/proxy/logo?url=${encodeURIComponent(ch.tvgLogo)}`}
                      alt=""
                      className="w-full h-full object-contain"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                  {playingChannel?.id === ch.id && (
                    <div className="absolute inset-0 bg-blue-600/20 flex items-center justify-center">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    </div>
                  )}
                </div>
                <div className="flex-1 flex items-center justify-between min-w-0 gap-4">
                  <span className={`text-sm truncate font-medium ${playingChannel?.id === ch.id ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                    {ch.displayName}
                  </span>
                  {groupEpg[ch.id]?.title && (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate italic">
                      {groupEpg[ch.id].title}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => toggleFavorite(e, ch.id)}
                    className={`p-1 rounded-full transition-all ${ch.isFavorite ? 'text-yellow-500 opacity-100' : 'text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    title={ch.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                  >
                    <svg className="w-4 h-4" fill={ch.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setPlayingChannel(ch)}
                    title="Play channel"
                    className="p-1 rounded-full text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-500 transition-all"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            {filteredChannels.length === 0 && (
              <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-8">No channels found</p>
            )}
          </div>
        </div>

        {/* Player */}
        {playingChannel && (
          <div className="min-h-0 flex flex-col">
            <ChannelPlayer
              key={playingChannel.id}
              title={playingChannel.displayName}
              channelId={playingChannel.id}
              playlistId={initialData.id}
              bufferSize={initialData.bufferSize}
              playbackProfile={initialData.playbackProfile}
              transcodeBackend={initialData.transcodeBackend}
              proxyStreams={initialData.proxyStreams}
              initialFavorite={playingChannel.isFavorite}
              onToggleFavorite={(isFavorite) => {
                setChannels(prev => prev.map(c => c.id === playingChannel.id ? { ...c, isFavorite } : c))
                setPlayingChannel(prev => prev ? { ...prev, isFavorite } : null)
              }}
              url={channelPlaybackUrl(playingChannel.id, playingChannel.streamUrl, {
                playbackProfile: initialData.playbackProfile,
                proxyStreams: initialData.proxyStreams,
              })}
              onClose={() => setPlayingChannel(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
