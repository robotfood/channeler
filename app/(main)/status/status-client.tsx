'use client'

import { useState, useEffect } from 'react'

type Session = {
  channelId: number
  profile: string
  backend: string
  audioProfile: string
  pid: number | null
  running: boolean
  startedAt: number
  lastAccessedAt: number
  lastError: string | null
  cpuPercent: number | null
  memoryPercent: number | null
}

type HardwareRecommendation = {
  backend: string
  encoder: string
  results: Record<string, string>
  renderDevice: string | null
}

type StatusData = {
  recommendedBackend: HardwareRecommendation
  sessions: Session[]
}

function formatUptime(startedAt: number) {
  const seconds = Math.floor((Date.now() - startedAt) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export default function StatusClient() {
  const [data, setData] = useState<StatusData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const resp = await fetch('/api/transcode/status')
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const json = await resp.json()
        if (!cancelled) {
          setData(json)
          setLastUpdated(new Date())
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (error) return <p className="text-red-500 text-sm">Failed to load status: {error}</p>
  if (!data) return <p className="text-sm text-gray-400">Loading...</p>

  const { recommendedBackend: hw, sessions } = data

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Stream Status</h1>
        {lastUpdated && (
          <span className="text-xs text-gray-400" suppressHydrationWarning>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h2 className="text-base font-semibold mb-4">Hardware</h2>
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div>
            <div className="text-xs text-gray-400 mb-1">Backend</div>
            <div className="font-mono text-sm font-semibold">{hw.backend}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Encoder</div>
            <div className="font-mono text-sm">{hw.encoder}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Render Device</div>
            <div className="font-mono text-sm text-gray-500">{hw.renderDevice ?? 'none'}</div>
          </div>
        </div>
        {Object.keys(hw.results).length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-2">Probe Results</div>
            <div className="space-y-1.5">
              {Object.entries(hw.results).map(([backend, result]) => (
                <div key={backend} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1 shrink-0 w-1.5 h-1.5 rounded-full ${result === 'ok' ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <span className="font-mono text-gray-500 w-28 shrink-0">{backend}</span>
                  <span className={result === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-gray-400 truncate'}>{result}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h2 className="text-base font-semibold mb-4">
          Active Streams
          {sessions.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">({sessions.length})</span>
          )}
        </h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-400">No active streams</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="pb-2 pr-4 font-medium">Channel</th>
                  <th className="pb-2 pr-4 font-medium">Profile</th>
                  <th className="pb-2 pr-4 font-medium">Backend</th>
                  <th className="pb-2 pr-4 font-medium">Audio</th>
                  <th className="pb-2 pr-4 font-medium">PID</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Uptime</th>
                  <th className="pb-2 font-medium">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sessions.map((s, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4 font-mono text-xs">{s.channelId}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{s.profile}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{s.backend}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-400">{s.audioProfile}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-400">{s.pid ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${
                        s.running
                          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.running ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {s.running ? 'running' : 'stopped'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-400" suppressHydrationWarning>
                      {formatUptime(s.startedAt)}
                    </td>
                    <td className="py-2 text-xs text-gray-400 max-w-xs truncate" title={s.lastError ?? undefined}>
                      {s.lastError ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
