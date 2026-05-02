'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { DashboardPlaylist, getFavoriteChannels } from '@/lib/app-data'
import ChannelPlayer from '@/components/channel-player'
import { channelPlaybackUrl } from '@/lib/stream-url'

type Playlist = DashboardPlaylist
type FavoriteChannel = Awaited<ReturnType<typeof getFavoriteChannels>>[number]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => flash())
    } else {
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      flash()
    }
  }

  function flash() {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className="shrink-0 text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function UrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-xs font-medium text-gray-400 dark:text-gray-500 w-8 shrink-0">{label}</span>
      <div className="flex items-center flex-1 min-w-0 gap-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5">
        <code className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1 select-all">{url}</code>
        <CopyButton text={url} />
      </div>
    </div>
  )
}

export default function DashboardClient({ initialPlaylists, favorites: initialFavorites, host }: {
  initialPlaylists: Playlist[]
  favorites: FavoriteChannel[]
  host: string
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>(initialPlaylists)
  const [favorites, setFavorites] = useState<FavoriteChannel[]>(initialFavorites)
  const [playingChannel, setPlayingChannel] = useState<FavoriteChannel | null>(null)

  async function deletePlaylist(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    await fetch(`/api/playlists/${id}`, { method: 'DELETE' })
    setPlaylists(p => p.filter(pl => pl.id !== id))
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      {favorites.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
            Favourites
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {favorites.map(ch => (
              <button
                key={ch.id}
                onClick={() => setPlayingChannel(ch)}
                className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 transition-colors text-left group"
              >
                <div className="relative w-12 h-10 shrink-0 flex items-center justify-center bg-gray-900 rounded overflow-hidden">
                  {ch.tvgLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/proxy/logo?url=${encodeURIComponent(ch.tvgLogo)}`}
                      alt=""
                      className="w-full h-full object-contain"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
                <span className="text-sm font-medium truncate flex-1">{ch.displayName}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Playlists</h1>
          <Link href="/playlists/new" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
            + Add Playlist
          </Link>
        </div>

        {playlists.length === 0 && (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <p className="text-lg mb-2">No playlists yet</p>
            <p className="text-sm">Add an M3U source to get started</p>
          </div>
        )}

        <div className="grid gap-4">
          {playlists.map(p => (
            <div key={p.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <Link href={`/playlists/${p.id}/watch`} className="group inline-flex items-center gap-2">
                    <h2 className="text-lg font-semibold truncate group-hover:text-blue-500 transition-colors">{p.name}</h2>
                    <svg className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </Link>
                  <div className="flex gap-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
                    <span>{p.channelEnabled} / {p.channelTotal} channels enabled</span>
                    <span>{p.groupCount} groups</span>
                    {p.m3uLastFetchedAt && <span suppressHydrationWarning>Updated {new Date(p.m3uLastFetchedAt).toLocaleString()}</span>}
                  </div>
                  <div className="mt-3 space-y-1">
                    <UrlRow label="M3U" url={`http://${host}/api/output/${p.slug}/m3u`} />
                    {p.epgUrl || p.epgLastFetchedAt || p.epgSourceType === 'xtream'
                      ? <UrlRow
                          label="EPG"
                          url={p.proxyEpg || p.epgSourceType === 'upload' ? `http://${host}/api/output/${p.slug}/xml` : p.epgUrl!}
                        />
                      : <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">No EPG configured</p>
                    }
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/playlists/${p.id}`} className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    Edit Playlist
                  </Link>
                  <Link href={`/playlists/${p.id}/settings`} className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    Settings
                  </Link>
                  <button
                    onClick={() => deletePlaylist(p.id, p.name)}
                    className="text-sm px-3 py-1.5 rounded bg-red-50 dark:bg-red-900/40 hover:bg-red-100 dark:hover:bg-red-900/70 text-red-600 dark:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {playingChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8">
          <div className="relative w-full max-w-4xl aspect-video bg-black rounded-lg overflow-hidden shadow-2xl">
            <ChannelPlayer
              key={playingChannel.id}
              title={playingChannel.displayName}
              channelId={playingChannel.id}
              playlistId={playingChannel.playlistId}
              bufferSize={playingChannel.bufferSize}
              playbackProfile={playingChannel.playbackProfile}
              transcodeBackend={playingChannel.transcodeBackend}
              proxyStreams={playingChannel.proxyStreams}
              initialFavorite={true}
              onToggleFavorite={(isFavorite) => {
                if (!isFavorite) setFavorites(f => f.filter(ch => ch.id !== playingChannel.id))
              }}
              url={channelPlaybackUrl(playingChannel.id, playingChannel.streamUrl, {
                playbackProfile: playingChannel.playbackProfile,
                proxyStreams: playingChannel.proxyStreams,
              })}
              onClose={() => setPlayingChannel(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
