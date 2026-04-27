import { db } from './db'
import { playlists } from './schema'
import { refreshM3U, refreshEPG } from './playlist-ops'
import { hasXtreamCredentials } from './xtream'

let schedulerTimer: ReturnType<typeof setInterval> | null = null

async function runCheck() {
  const all = await db.select().from(playlists)
  const now = new Date()

  for (const p of all) {
    if (!p.autoRefresh) continue

    // M3U Refresh
    const m3uIntervalMs = p.m3uRefreshInterval * 60 * 60 * 1000
    const m3uLast = p.m3uLastFetchedAt ? new Date(p.m3uLastFetchedAt) : new Date(0)
    const m3uDue = now.getTime() - m3uLast.getTime() >= m3uIntervalMs

    if (m3uDue) {
      if ((p.m3uSourceType === 'xtream' && hasXtreamCredentials(p)) || (p.m3uSourceType !== 'xtream' && p.m3uUrl)) {
        try { await refreshM3U(p.id, 'auto') } catch {}
      }
    }

    // EPG Refresh
    const epgIntervalMs = p.epgRefreshInterval * 60 * 60 * 1000
    const epgLast = p.epgLastFetchedAt ? new Date(p.epgLastFetchedAt) : new Date(0)
    const epgDue = now.getTime() - epgLast.getTime() >= epgIntervalMs

    if (epgDue) {
      if ((p.epgSourceType === 'xtream' && hasXtreamCredentials(p)) || (p.epgSourceType !== 'xtream' && p.epgUrl)) {
        try { await refreshEPG(p.id, 'auto') } catch {}
      }
    }
  }
}

export async function reloadScheduler() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null }
  
  // Run every 5 minutes
  schedulerTimer = setInterval(runCheck, 5 * 60 * 1000)
  
  // Also run immediately on start
  runCheck().catch(() => {})
}
