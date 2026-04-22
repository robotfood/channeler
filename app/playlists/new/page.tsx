'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type SourceTab = 'url' | 'upload'

const inputCls = 'w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function NewPlaylist() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [m3uTab, setM3uTab] = useState<SourceTab>('url')
  const [m3uUrl, setM3uUrl] = useState('')
  const [m3uFile, setM3uFile] = useState<File | null>(null)
  const [epgTab, setEpgTab] = useState<SourceTab>('url')
  const [epgUrl, setEpgUrl] = useState('')
  const [epgFile, setEpgFile] = useState<File | null>(null)
  const [skipEpg, setSkipEpg] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function tabCls(active: boolean) {
    return `px-3 py-1 rounded text-sm ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('name', name || (m3uUrl ? new URL(m3uUrl).hostname : 'My Playlist'))
      if (m3uTab === 'url') fd.append('m3uUrl', m3uUrl)
      else if (m3uFile) fd.append('m3uFile', m3uFile)
      if (!skipEpg) {
        if (epgTab === 'url' && epgUrl) fd.append('epgUrl', epgUrl)
        else if (epgFile) fd.append('epgFile', epgFile)
      }

      const res = await fetch('/api/playlists', { method: 'POST', body: fd })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      const { id } = await res.json()
      router.push(`/playlists/${id}`)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Add Playlist</h1>
      <form onSubmit={submit} className="space-y-6">
        <div>
          <label className={labelCls}>Playlist name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="My Playlist" className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>M3U source</label>
          <div className="flex gap-1 mb-3">
            {(['url', 'upload'] as SourceTab[]).map(t => (
              <button type="button" key={t} onClick={() => setM3uTab(t)} className={tabCls(m3uTab === t)}>
                {t === 'url' ? 'URL' : 'Upload'}
              </button>
            ))}
          </div>
          {m3uTab === 'url'
            ? <input type="url" value={m3uUrl} onChange={e => setM3uUrl(e.target.value)} required
                placeholder="https://example.com/playlist.m3u" className={inputCls} />
            : <input type="file" accept=".m3u,.m3u8" onChange={e => setM3uFile(e.target.files?.[0] ?? null)} required
                className="text-sm text-gray-600 dark:text-gray-300" />
          }
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls}>EPG source</label>
            <button type="button" onClick={() => setSkipEpg(s => !s)}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              {skipEpg ? 'Add EPG' : 'Skip EPG'}
            </button>
          </div>
          {!skipEpg && (
            <>
              <div className="flex gap-1 mb-3">
                {(['url', 'upload'] as SourceTab[]).map(t => (
                  <button type="button" key={t} onClick={() => setEpgTab(t)} className={tabCls(epgTab === t)}>
                    {t === 'url' ? 'URL' : 'Upload'}
                  </button>
                ))}
              </div>
              {epgTab === 'url'
                ? <input type="url" value={epgUrl} onChange={e => setEpgUrl(e.target.value)}
                    placeholder="https://example.com/epg.xml.gz" className={inputCls} />
                : <input type="file" accept=".xml,.xml.gz" onChange={e => setEpgFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-gray-600 dark:text-gray-300" />
              }
            </>
          )}
          {skipEpg && <p className="text-xs text-gray-400 dark:text-gray-600">EPG can be added later in playlist settings</p>}
        </div>

        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded font-medium transition-colors">
          {loading ? 'Importing...' : 'Create Playlist'}
        </button>
      </form>
    </div>
  )
}
