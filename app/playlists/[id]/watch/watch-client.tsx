'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import type { PlaylistData } from '@/lib/app-data'
import ChannelPlayer from '@/components/channel-player'
import { channelPlaybackUrl } from '@/lib/stream-url'

type Channel = PlaylistData['channels'][number]

export default function WatchClient({ initialData }: { initialData: PlaylistData }) {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    initialData.groups.find(g => g.enabled)?.id ?? null
  )
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null)
  const [groupEpg, setGroupEpg] = useState<Record<number, { title: string }>>({})
  const [channelSearch, setChannelSearch] = useState('')

  const enabledGroups = useMemo(() => initialData.groups.filter(g => g.enabled), [initialData.groups])
  
  const filteredChannels = useMemo(() => {
    if (!selectedGroupId) return []
    return initialData.channels.filter(c => 
      c.groupId === selectedGroupId && 
      c.enabled && 
      !c.isDeleted &&
      c.displayName.toLowerCase().includes(channelSearch.toLowerCase())
    )
  }, [initialData.channels, selectedGroupId, channelSearch])

  useEffect(() => {
    if (!selectedGroupId) return
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
              <button
                key={ch.id}
                onClick={() => setPlayingChannel(ch)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors group text-left ${playingChannel?.id === ch.id ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800/50' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <div className="relative w-8 h-8 shrink-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded overflow-hidden">
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
              </button>
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
              title={playingChannel.displayName}
              channelId={playingChannel.id}
              bufferSize={initialData.bufferSize}
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
