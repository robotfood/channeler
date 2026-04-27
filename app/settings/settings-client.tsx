'use client'

import { useState } from 'react'
import type { SettingsData } from '@/lib/app-data'

const INTERVALS = [
  { label: '1 hour', value: '3600' },
  { label: '6 hours', value: '21600' },
  { label: '12 hours', value: '43200' },
  { label: '24 hours', value: '86400' },
  { label: '7 days', value: '604800' },
]

export default function SettingsClient({ initialData }: { initialData: SettingsData }) {
  const [settings, setSettings] = useState<Record<string, string>>(initialData.settings)
  const [log] = useState(initialData.log)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const set = (key: string, value: string) => setSettings(s => ({ ...s, [key]: value }))

  async function save() {
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    showToast('Settings saved')
    setSaving(false)
  }

  const selectCls = (disabled: boolean) =>
    `bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500 ${disabled ? 'opacity-40' : ''}`

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5 space-y-5">
        <h2 className="text-base font-semibold">Auto-Refresh</h2>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="m3uEnabled"
                checked={settings.m3u_auto_refresh_enabled === 'true'}
                onChange={e => set('m3u_auto_refresh_enabled', e.target.checked ? 'true' : 'false')}
                className="rounded border-gray-300 dark:border-gray-600 accent-blue-500" />
              <label htmlFor="m3uEnabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">M3U auto-refresh</label>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-500 mb-1">Interval</label>
              <select value={settings.m3u_refresh_interval_seconds ?? '86400'}
                onChange={e => set('m3u_refresh_interval_seconds', e.target.value)}
                disabled={settings.m3u_auto_refresh_enabled !== 'true'}
                className={selectCls(settings.m3u_auto_refresh_enabled !== 'true')}>
                {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="epgEnabled"
                checked={settings.epg_auto_refresh_enabled === 'true'}
                onChange={e => set('epg_auto_refresh_enabled', e.target.checked ? 'true' : 'false')}
                className="rounded border-gray-300 dark:border-gray-600 accent-blue-500" />
              <label htmlFor="epgEnabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">EPG auto-refresh</label>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-500 mb-1">Interval</label>
              <select value={settings.epg_refresh_interval_seconds ?? '86400'}
                onChange={e => set('epg_refresh_interval_seconds', e.target.value)}
                disabled={settings.epg_auto_refresh_enabled !== 'true'}
                className={selectCls(settings.epg_auto_refresh_enabled !== 'true')}>
                {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h2 className="text-base font-semibold mb-4">Refresh Log</h2>
        {log.length === 0
          ? <p className="text-gray-400 dark:text-gray-600 text-sm">No refresh activity yet</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-800">
                    <th className="pb-2 pr-4">Time</th>
                    <th className="pb-2 pr-4">Playlist</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">By</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {log.map(entry => (
                    <tr key={entry.id} className="text-gray-700 dark:text-gray-300">
                      <td className="py-2 pr-4 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap" suppressHydrationWarning>
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>

                      <td className="py-2 pr-4 truncate max-w-32">{entry.playlistName ?? '—'}</td>
                      <td className="py-2 pr-4 uppercase text-xs">{entry.type}</td>
                      <td className="py-2 pr-4 text-xs text-gray-400 dark:text-gray-500">{entry.triggeredBy}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${entry.status === 'success' ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400'}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-gray-400 dark:text-gray-500 truncate max-w-48">{entry.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-sm shadow-lg text-gray-900 dark:text-gray-100">
          {toast}
        </div>
      )}
    </div>
  )
}
