import { db } from './db'
import { settings, playlists } from './schema'
import { refreshM3U, refreshEPG } from './playlist-ops'
import { hasXtreamCredentials } from './xtream'

let m3uTimer: ReturnType<typeof setInterval> | null = null
let epgTimer: ReturnType<typeof setInterval> | null = null

function getSetting(rows: { key: string; value: string }[], key: string): string {
  return rows.find(r => r.key === key)?.value ?? ''
}

async function runM3URefresh() {
  const all = await db.select().from(playlists)
  for (const p of all) {
    if (!p.autoRefresh) continue
    if (p.m3uSourceType === 'xtream' && !hasXtreamCredentials(p)) continue
    if (p.m3uSourceType !== 'xtream' && !p.m3uUrl) continue
    try { await refreshM3U(p.id, 'auto') } catch {}
  }
}

async function runEPGRefresh() {
  const all = await db.select().from(playlists)
  for (const p of all) {
    if (!p.autoRefresh) continue
    if (p.epgSourceType === 'xtream' && !hasXtreamCredentials(p)) continue
    if (p.epgSourceType !== 'xtream' && !p.epgUrl) continue
    try { await refreshEPG(p.id, 'auto') } catch {}
  }
}

export async function reloadScheduler() {
  if (m3uTimer) { clearInterval(m3uTimer); m3uTimer = null }
  if (epgTimer) { clearInterval(epgTimer); epgTimer = null }

  const rows = await db.select().from(settings)
  const m3uEnabled = getSetting(rows, 'm3u_auto_refresh_enabled') === 'true'
  const epgEnabled = getSetting(rows, 'epg_auto_refresh_enabled') === 'true'
  const m3uInterval = parseInt(getSetting(rows, 'm3u_refresh_interval_seconds') || '86400') * 1000
  const epgInterval = parseInt(getSetting(rows, 'epg_refresh_interval_seconds') || '86400') * 1000

  if (m3uEnabled) m3uTimer = setInterval(runM3URefresh, m3uInterval)
  if (epgEnabled) epgTimer = setInterval(runEPGRefresh, epgInterval)
}
