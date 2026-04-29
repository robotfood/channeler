'use client'

import { useState, useEffect } from 'react'
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

const PLAYBACK_PROFILES = [
  {
    value: 'proxy',
    label: 'Proxy passthrough',
    detail: 'Routes the original stream through this server without changing video quality. Ideal buffer: medium.',
    fps: 'Source',
    res: 'Source',
    quality: 'No changes',
  },
  {
    value: 'stable_hls',
    label: 'Stable HLS remux',
    detail: 'Repackages the source into local HLS segments for steadier playback, without re-encoding. Ideal buffer: large.',
    fps: 'Source',
    res: 'Source',
    quality: 'No changes',
  },
  {
    value: 'transcode_720p',
    label: '720p Transcode (Min)',
    detail: 'Upscales lower resolutions to 720p; keeps 1080p+ sources at full quality. Uses selected hardware backend.',
    fps: 'Source',
    res: 'Min 720p',
    quality: 'Lanczos (No-Downscale)',
  },
  {
    value: 'transcode_1080p',
    label: '1080p Transcode (Min)',
    detail: 'Upscales lower resolutions to 1080p; keeps 4K sources at full quality. Uses selected hardware backend.',
    fps: 'Source',
    res: 'Min 1080p',
    quality: 'Lanczos (No-Downscale)',
  },
  {
    value: 'transcode_4k',
    label: '4K Transcode',
    detail: 'Upscales or normalizes streams to 2160p HLS. Higher bitrate, best for 4K displays. Experimental.',
    fps: 'Source',
    res: '4K',
    quality: 'Lanczos scaling',
  },
  {
    value: 'enhanced_1080p',
    label: 'Enhanced 1080p',
    detail: 'Deinterlaces, scales, and lightly sharpens to improve soft or interlaced feeds.',
    fps: 'Source',
    res: '1080p',
    quality: 'Deinterlace, Scale, Sharpen',
  },
  {
    value: 'clean_1080p',
    label: 'Clean 1080p',
    detail: 'Adds denoise plus mild sharpening for low-bitrate streams with compression noise.',
    fps: 'Source',
    res: '1080p',
    quality: 'Deinterlace, Denoise, Scale, Sharpen',
  },
  {
    value: 'smooth_720p60',
    label: 'Deinterlace 720p60',
    detail: 'Turns interlaced field motion into 60 fps output at 720p. Best for true interlaced sports/news feeds.',
    fps: '60',
    res: '720p',
    quality: 'Field-rate deinterlace',
  },
  {
    value: 'smooth_1080p60',
    label: 'Deinterlace 1080p60',
    detail: 'Heavy profile for true 1080i feeds only. Requires strong CPU/GPU headroom and may stall weaker servers.',
    fps: '60',
    res: '1080p',
    quality: 'Heavy field-rate deinterlace',
  },
  {
    value: 'sports_720p60',
    label: 'Sports 720p60',
    detail: 'Field-rate deinterlaces to 720p60 with subtle detail enhancement and noise reduction where supported.',
    fps: '60',
    res: '720p',
    quality: 'Deinterlace + enhancement',
  },
]

type PlaybackProfileValue = typeof PLAYBACK_PROFILES[number]['value']

const TRANSCODE_BACKENDS = [
  { name: 'auto', detail: 'Runs short FFmpeg test encodes and uses the first working hardware backend, then CPU if none pass.' },
  { name: 'vaapi', detail: 'Uses Linux VAAPI through FFmpeg h264_vaapi. Best first choice for Intel iGPU Docker/Unraid hosts.' },
  { name: 'qsv', detail: 'Uses Intel Quick Sync through FFmpeg h264_qsv. Best for Intel iGPU servers with /dev/dri access.' },
  { name: 'amf', detail: 'Uses AMD hardware encoding through FFmpeg h264_amf when the host exposes a supported AMD GPU.' },
  { name: 'videotoolbox', detail: 'Uses Apple hardware encoding through FFmpeg h264_videotoolbox on macOS.' },
  { name: 'cpu', detail: 'Forces libx264 software encoding. Most compatible, but uses the most CPU.' },
]

const AUDIO_PROFILES = [
  {
    value: 'standard',
    label: 'Standard AAC',
    detail: 'Re-encodes audio for compatibility with a light volume normalization pass while preserving the source channel layout.',
  },
  {
    value: 'enhanced_5_1',
    label: 'Enhanced 5.1',
    detail: 'Applies aggressive volume normalization and attempts a stereo-to-5.1 upmix. Subjective and higher bitrate.',
  },
] as const

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
  const [transcodeBackend, setTranscodeBackend] = useState(initialData.transcodeBackend ?? 'auto')
  const [audioProfile, setAudioProfile] = useState(initialData.audioProfile ?? 'standard')
  const [playbackProfile, setPlaybackProfile] = useState(
    initialData.playbackProfile === 'direct' && initialData.proxyStreams ? 'proxy' : initialData.playbackProfile ?? 'direct'
  )
  const [proxyProfile, setProxyProfile] = useState<PlaybackProfileValue>(
    playbackProfile === 'direct' ? 'proxy' : playbackProfile as PlaybackProfileValue
  )
  const [proxyEpg, setProxyEpg] = useState(initialData.proxyEpg)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [systemInfo, setSystemInfo] = useState<{
    cpuCores: number
    threading: string | number
    backend: string
    encoder: string
  } | null>(null)

  useEffect(() => {
    async function fetchSystemInfo() {
      try {
        const res = await fetch('/api/transcode/status')
        if (res.ok) {
          const data = await res.json()
          setSystemInfo({
            cpuCores: data.recommendedBackend.cpuCores,
            threading: data.recommendedBackend.threading,
            backend: data.recommendedBackend.backend,
            encoder: data.recommendedBackend.encoder,
          })
        }
      } catch {}
    }
    fetchSystemInfo()
  }, [])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }
  const useProxyPlayback = playbackProfile !== 'direct'

  function selectDirectPlayback() {
    setPlaybackProfile('direct')
  }

  function selectProxyPlayback() {
    setPlaybackProfile(proxyProfile)
  }

  function selectProxyProfile(profile: PlaybackProfileValue) {
    setProxyProfile(profile)
    setPlaybackProfile(profile)
  }

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
        playbackProfile,
        transcodeBackend,
        audioProfile,
        proxyStreams: playbackProfile !== 'direct',
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

        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-gray-800 dark:text-gray-200">Playback route</h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">Choose whether clients connect to the source directly or receive a server-managed stream.</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${!useProxyPlayback ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'}`}>
              <input type="radio" name="playbackRoute" checked={!useProxyPlayback} onChange={selectDirectPlayback}
                className="mt-1 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600" />
              <span>
                <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">Direct source</span>
                <span className="block text-xs leading-5 text-gray-500 dark:text-gray-500">Clients play the provider URL directly.</span>
              </span>
            </label>

            <label className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${useProxyPlayback ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'}`}>
              <input type="radio" name="playbackRoute" checked={useProxyPlayback} onChange={selectProxyPlayback}
                className="mt-1 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600" />
              <span>
                <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">Proxy through server</span>
                <span className="block text-xs leading-5 text-gray-500 dark:text-gray-500">Clients receive a stream from this app.</span>
              </span>
            </label>
          </div>

          {useProxyPlayback && (
            <div className="space-y-3">
              <div className="flex flex-col gap-1 p-3 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                <label htmlFor="transcodeBackend" className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Global Transcode Backend</label>
                <select id="transcodeBackend" value={transcodeBackend} onChange={e => setTranscodeBackend(e.target.value)}
                  className="w-full max-w-[260px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 mt-1">
                  <option value="auto">Auto detect (Recommended)</option>
                  <option value="vaapi">Linux VAAPI</option>
                  <option value="qsv">Intel QSV</option>
                  <option value="amf">AMD AMF</option>
                  <option value="videotoolbox">Apple VideoToolbox</option>
                  <option value="cpu">Force CPU fallback</option>
                </select>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Controls how video is encoded for ALL profiles below. Auto validates hardware and falls back to CPU if needed.</p>
                {systemInfo && (
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 p-2 bg-white/50 dark:bg-black/20 rounded border border-blue-100/50 dark:border-blue-900/20 text-[10px] font-mono text-blue-600/80 dark:text-blue-400/80">
                    <div className="flex justify-between"><span>Cores:</span> <span className="font-bold">{systemInfo.cpuCores}</span></div>
                    <div className="flex justify-between"><span>Threads:</span> <span className="font-bold">{systemInfo.threading}</span></div>
                    <div className="flex justify-between"><span>Detected:</span> <span className="font-bold uppercase">{systemInfo.backend}</span></div>
                    <div className="flex justify-between"><span>Encoder:</span> <span className="font-bold">{systemInfo.encoder}</span></div>
                  </div>
                )}
              </div>

              <fieldset className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/30">
                <legend className="px-1 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Proxy mode</legend>
                {PLAYBACK_PROFILES.map(profile => (
                  <label key={profile.value}
                    className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${playbackProfile === profile.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'}`}>
                    <input type="radio" name="proxyPlaybackProfile" value={profile.value} checked={playbackProfile === profile.value}
                      onChange={() => selectProxyProfile(profile.value)}
                      className="mt-1 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600" />
                    <span>
                      <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">{profile.label}</span>
                      <span className="block text-xs leading-5 text-gray-500 dark:text-gray-500 mb-1">{profile.detail}</span>
                      <span className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase font-semibold tracking-wider text-gray-400 dark:text-gray-500">
                        <span>FPS: {profile.fps}</span>
                        <span>Res: {profile.res}</span>
                        <span>Quality: {profile.quality}</span>
                      </span>
                    </span>
                  </label>
                ))}
                <div className="space-y-1 pt-1 text-[10px] leading-4 text-gray-400 dark:text-gray-500">
                  <p>Transcode, enhancement, and 60 FPS modes require FFmpeg. Hardware modes use the backend setting above.</p>
                  <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
                    {TRANSCODE_BACKENDS.map(backend => (
                      <div key={backend.name} className="contents">
                        <dt className="font-medium text-gray-500 dark:text-gray-400">{backend.name}</dt>
                        <dd>{backend.detail}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </fieldset>

              <fieldset className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/30">
                <legend className="px-1 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Audio processing</legend>
                <p className="px-1 text-[10px] leading-4 text-gray-400 dark:text-gray-500">These options are separate from the playback profile and only affect encoded output.</p>
                {AUDIO_PROFILES.map(profile => (
                  <label key={profile.value}
                    className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${audioProfile === profile.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'}`}>
                    <input type="radio" name="audioProfile" value={profile.value} checked={audioProfile === profile.value}
                      onChange={() => setAudioProfile(profile.value)}
                      className="mt-1 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600" />
                    <span>
                      <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">{profile.label}</span>
                      <span className="block text-xs leading-5 text-gray-500 dark:text-gray-500">{profile.detail}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
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
