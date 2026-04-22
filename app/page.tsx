'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Playlist {
  id: number
  name: string
  m3uUrl: string | null
  m3uSourceType: string
  m3uLastFetchedAt: string | null
  epgUrl: string | null
  epgLastFetchedAt: string | null
  channelTotal: number
  channelEnabled: number
  groupCount: number
}

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

export default function Dashboard() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [host, setHost] = useState('localhost:3000')

  useEffect(() => {
    setHost(window.location.host)
    fetch('/api/playlists').then(r => r.json()).then(data => { setPlaylists(data); setLoading(false) })
  }, [])

  async function deletePlaylist(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    await fetch(`/api/playlists/${id}`, { method: 'DELETE' })
    setPlaylists(p => p.filter(pl => pl.id !== id))
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div className="max-w-5xl mx-auto">
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
                <h2 className="text-lg font-semibold truncate">{p.name}</h2>
                <div className="flex gap-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>{p.channelEnabled} / {p.channelTotal} channels enabled</span>
                  <span>{p.groupCount} groups</span>
                  {p.m3uLastFetchedAt && <span>Updated {new Date(p.m3uLastFetchedAt).toLocaleString()}</span>}
                </div>
                <div className="mt-3 space-y-1">
                  <UrlRow label="M3U" url={`http://${host}/api/output/${p.id}/m3u`} />
                  {p.epgUrl || p.epgLastFetchedAt
                    ? <UrlRow label="EPG" url={`http://${host}/api/output/${p.id}/xml`} />
                    : <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">No EPG configured</p>
                  }
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link href={`/playlists/${p.id}`} className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                  Edit
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
    </div>
  )
}
