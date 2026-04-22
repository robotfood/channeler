'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface PlaylistSettings {
  id: number
  name: string
  m3uUrl: string | null
  m3uSourceType: string
  epgUrl: string | null
  epgSourceType: string | null
  autoRefresh: boolean
}

const inputCls = 'w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function PlaylistSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [data, setData] = useState<PlaylistSettings | null>(null)
  const [name, setName] = useState('')
  const [m3uUrl, setM3uUrl] = useState('')
  const [epgUrl, setEpgUrl] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    fetch(`/api/playlists/${id}`).then(r => r.json()).then(d => {
      setData(d)
      setName(d.name)
      setM3uUrl(d.m3uUrl ?? '')
      setEpgUrl(d.epgUrl ?? '')
      setAutoRefresh(d.autoRefresh)
    })
  }, [id])

  async function save() {
    setSaving(true)
    await fetch(`/api/playlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, m3uUrl: m3uUrl || null, epgUrl: epgUrl || null, autoRefresh }),
    })
    showToast('Saved')
    setSaving(false)
  }

  async function deletePlaylist() {
    if (!confirm('Delete this playlist? All data will be lost.')) return
    await fetch(`/api/playlists/${id}`, { method: 'DELETE' })
    router.push('/')
  }

  if (!data) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Link href={`/playlists/${id}`} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm">← Editor</Link>
        <h1 className="text-xl font-semibold">Playlist Settings</h1>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5 space-y-4">
        <div>
          <label className={labelCls}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>M3U URL</label>
          <input value={m3uUrl} onChange={e => setM3uUrl(e.target.value)}
            placeholder="https://example.com/playlist.m3u" className={inputCls} />
          {data.m3uSourceType === 'upload' && (
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">Originally uploaded — adding a URL enables auto-refresh</p>
          )}
        </div>

        <div>
          <label className={labelCls}>EPG URL</label>
          <input value={epgUrl} onChange={e => setEpgUrl(e.target.value)}
            placeholder="https://example.com/epg.xml.gz (leave blank for none)" className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Upload new EPG file</label>
          <input type="file" accept=".xml,.xml.gz"
            onChange={async e => {
              const file = e.target.files?.[0]
              if (!file) return
              await fetch(`/api/playlists/${id}/refresh-epg`, { method: 'POST' })
              showToast('EPG uploaded')
            }}
            className="text-sm text-gray-600 dark:text-gray-300" />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="autoRefresh" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 accent-blue-500" />
          <label htmlFor="autoRefresh" className="text-sm text-gray-700 dark:text-gray-300">Include in global auto-refresh</label>
        </div>

        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-5">
        <h2 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">Danger Zone</h2>
        <p className="text-sm text-gray-500 dark:text-gray-500 mb-3">Permanently delete this playlist and all its channel settings.</p>
        <button onClick={deletePlaylist}
          className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
          Delete Playlist
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-sm shadow-lg text-gray-900 dark:text-gray-100">
          {toast}
        </div>
      )}
    </div>
  )
}
