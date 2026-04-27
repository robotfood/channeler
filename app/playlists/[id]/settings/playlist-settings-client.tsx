'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PlaylistSettingsData } from '@/lib/app-data'

type PlaylistSettings = PlaylistSettingsData

interface RefreshLogEntry {
  id: number
  playlistId: number | null
  playlistName: string | null
  type: string
  triggeredBy: string
  status: string
  detail: string | null
  createdAt: string
}

const inputCls = 'w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

const INTERVALS = [
  { label: '1 hour', value: '1' },
  { label: '6 hours', value: '6' },
  { label: '12 hours', value: '12' },
  { label: '24 hours', value: '24' },
  { label: '7 days', value: '168' },
]

export default function PlaylistSettingsClient({ initialData, playlistId }: {
  initialData: PlaylistSettings & { log: RefreshLogEntry[] }
  playlistId: string
}) {
  const router = useRouter()
  const [data] = useState<PlaylistSettings>(initialData)
  const [name, setName] = useState(initialData.name)
  const [m3uUrl, setM3uUrl] = useState(initialData.m3uUrl ?? '')
  const [xtreamServerUrl, setXtreamServerUrl] = useState(initialData.xtreamServerUrl ?? '')
  const [xtreamUsername, setXtreamUsername] = useState(initialData.xtreamUsername ?? '')
  const [xtreamPassword, setXtreamPassword] = useState(initialData.xtreamPassword ?? '')
  const [xtreamOutput, setXtreamOutput] = useState(initialData.xtreamOutput ?? 'ts')
  const [epgUrl, setEpgUrl] = useState(initialData.epgUrl ?? '')
  const [autoRefresh, setAutoRefresh] = useState(initialData.autoRefresh)
  const [m3uRefreshInterval, setM3uRefreshInterval] = useState(initialData.m3uRefreshInterval ?? 24)
  const [epgRefreshInterval, setEpgRefreshInterval] = useState(initialData.epgRefreshInterval ?? 24)
  const [bufferSize, setBufferSize] = useState(initialData.bufferSize ?? 'medium')
  const [proxyStreams, setProxyStreams] = useState(initialData.proxyStreams)
  const [proxyEpg, setProxyEpg] = useState(initialData.proxyEpg)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  async function save() {
    setSaving(true)
    await fetch(`/api/playlists/${playlistId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        m3uUrl: data.m3uSourceType === 'xtream' ? null : m3uUrl || null,
        epgUrl: data.epgSourceType === 'xtream' ? null : epgUrl || null,
        autoRefresh,
        m3uRefreshInterval,
        epgRefreshInterval,
        bufferSize,
        proxyStreams,
        proxyEpg,
        xtreamServerUrl: data.m3uSourceType === 'xtream' ? xtreamServerUrl || null : null,
        xtreamUsername: data.m3uSourceType === 'xtream' ? xtreamUsername || null : null,
        xtreamPassword: data.m3uSourceType === 'xtream' ? xtreamPassword || null : null,
        xtreamOutput: data.m3uSourceType === 'xtream' ? xtreamOutput : null,
      }),
    })
    showToast('Saved')
    setSaving(false)
  }

  async function deletePlaylist() {
    if (!confirm('Delete this playlist? All data will be lost.')) return
    await fetch(`/api/playlists/${playlistId}`, { method: 'DELETE' })
    router.push('/')
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Link href={`/playlists/${playlistId}`} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm">← Editor</Link>
        <h1 className="text-xl font-semibold">Playlist Settings</h1>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5 space-y-4">
        <div>
          <label className={labelCls}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
        </div>

        {data.m3uSourceType === 'xtream' ? (
          <>
            <div>
              <label className={labelCls}>Xtream server URL</label>
              <input value={xtreamServerUrl} onChange={e => setXtreamServerUrl(e.target.value)}
                placeholder="https://provider.example:8080" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Xtream username</label>
              <input value={xtreamUsername} onChange={e => setXtreamUsername(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Xtream password</label>
              <input type="password" value={xtreamPassword} onChange={e => setXtreamPassword(e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Xtream output</label>
              <select value={xtreamOutput} onChange={e => setXtreamOutput(e.target.value)} className={inputCls}>
                <option value="ts">TS output</option>
                <option value="m3u8">M3U8 output</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>EPG source</label>
              <p className="text-sm text-gray-500 dark:text-gray-400">EPG refresh uses the Xtream XMLTV endpoint for this account.</p>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}

        <div>
          <label className={labelCls}>Upload new EPG file</label>
          <input type="file" accept=".xml,.xml.gz"
            onChange={async e => {
              const file = e.target.files?.[0]
              if (!file) return
              await fetch(`/api/playlists/${playlistId}/refresh-epg`, { method: 'POST' })
              showToast('EPG uploaded')
            }}
            className="text-sm text-gray-600 dark:text-gray-300" />
        </div>

        <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="autoRefresh" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 accent-blue-500" />
            <label htmlFor="autoRefresh" className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable auto-refresh for this playlist</label>
          </div>

          {autoRefresh && (
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-500 mb-1">M3U Interval</label>
                <select value={m3uRefreshInterval} onChange={e => setM3uRefreshInterval(parseInt(e.target.value))}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500">
                  {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-500 mb-1">EPG Interval</label>
                <select value={epgRefreshInterval} onChange={e => setEpgRefreshInterval(parseInt(e.target.value))}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500">
                  {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="proxyStreams" checked={proxyStreams} onChange={e => setProxyStreams(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 accent-blue-500" />
          <label htmlFor="proxyStreams" className="text-sm text-gray-700 dark:text-gray-300">Proxy streams through this server</label>
        </div>

        <div className="flex flex-col gap-1 pl-6">
          <label htmlFor="bufferSize" className="text-xs text-gray-500 dark:text-gray-400">Playback Buffer</label>
          <select id="bufferSize" value={bufferSize} onChange={e => setBufferSize(e.target.value)}
            className="w-full max-w-[200px] bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500">
            <option value="small">Small (Fastest)</option>
            <option value="medium">Medium (Balanced)</option>
            <option value="large">Large (Stable)</option>
            <option value="xl">XL (Maximum Stability)</option>
          </select>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">Larger buffers reduce stutter but increase startup delay.</p>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="proxyEpg" checked={proxyEpg} onChange={e => setProxyEpg(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 accent-blue-500" />
          <label htmlFor="proxyEpg" className="text-sm text-gray-700 dark:text-gray-300">Proxy EPG through this server (enables filtering)</label>
        </div>

        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {initialData.log.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h2 className="text-base font-semibold mb-4">Recent Activity</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-800">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {initialData.log.map((entry: RefreshLogEntry) => (
                  <tr key={entry.id} className="text-gray-700 dark:text-gray-300">
                    <td className="py-2 pr-4 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap" suppressHydrationWarning>
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 uppercase text-xs font-medium">{entry.type}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${entry.status === 'success' ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400'}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-gray-400 dark:text-gray-500 truncate max-w-48" title={entry.detail ?? ''}>{entry.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
