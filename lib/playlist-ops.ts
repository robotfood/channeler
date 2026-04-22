import { db, dataPath } from './db'
import { playlists, groups, channels, refreshLog } from './schema'
import { parseM3U } from './m3u-parser'
import { eq, and, inArray, sql } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { promisify } from 'util'

const gunzip = promisify(zlib.gunzip)

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

export async function fetchBinary(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

export function rawM3UPath(id: number) {
  return path.join(dataPath, 'raw', `${id}.m3u`)
}

export function rawEPGPath(id: number) {
  return path.join(dataPath, 'raw', `${id}.xml`)
}

export async function ingestM3U(playlistId: number, content: string) {
  fs.writeFileSync(rawM3UPath(playlistId), content, 'utf-8')
  const parsed = parseM3U(content)

  // group unique group titles preserving order
  const groupOrder: string[] = []
  const groupSet = new Set<string>()
  for (const ch of parsed) {
    if (!groupSet.has(ch.groupTitle)) {
      groupSet.add(ch.groupTitle)
      groupOrder.push(ch.groupTitle)
    }
  }

  // upsert groups
  const existingGroups = await db.select().from(groups).where(eq(groups.playlistId, playlistId))
  const existingByName = new Map(existingGroups.map(g => [g.originalName, g]))

  const groupIdMap = new Map<string, number>()
  for (let i = 0; i < groupOrder.length; i++) {
    const name = groupOrder[i]
    const existing = existingByName.get(name)
    if (existing) {
      groupIdMap.set(name, existing.id)
    } else {
      const [inserted] = await db.insert(groups).values({
        playlistId,
        originalName: name,
        displayName: name,
        enabled: true,
        sortOrder: existingGroups.length + i,
      }).returning()
      groupIdMap.set(name, inserted.id)
    }
  }

  // upsert channels
  const existingChannels = await db.select().from(channels).where(eq(channels.playlistId, playlistId))
  const existingByTvgId = new Map(existingChannels.filter(c => c.tvgId).map(c => [c.tvgId!, c]))
  const existingByTvgName = new Map(existingChannels.filter(c => c.tvgName).map(c => [c.tvgName, c]))
  const existingByDisplayName = new Map(existingChannels.map(c => [c.displayName, c]))

  let added = 0
  let updated = 0
  const seenIds = new Set<number>()

  for (let i = 0; i < parsed.length; i++) {
    const ch = parsed[i]
    const groupId = groupIdMap.get(ch.groupTitle)
    if (!groupId) continue

    const existing =
      (ch.tvgId && existingByTvgId.get(ch.tvgId)) ||
      (ch.tvgName && existingByTvgName.get(ch.tvgName)) ||
      existingByDisplayName.get(ch.displayName)

    if (existing) {
      seenIds.add(existing.id)
      await db.update(channels)
        .set({ streamUrl: ch.streamUrl, groupId, tvgLogo: ch.tvgLogo, sortOrder: i })
        .where(eq(channels.id, existing.id))
      updated++
    } else {
      const [inserted] = await db.insert(channels).values({
        playlistId,
        groupId,
        tvgId: ch.tvgId || null,
        tvgName: ch.tvgName,
        tvgLogo: ch.tvgLogo,
        displayName: ch.displayName,
        streamUrl: ch.streamUrl,
        enabled: true,
        sortOrder: i,
      }).returning()
      seenIds.add(inserted.id)
      added++
    }
  }

  // disable channels no longer in source
  const missingIds = existingChannels.map(c => c.id).filter(id => !seenIds.has(id))
  let removed = 0
  if (missingIds.length > 0) {
    await db.update(channels).set({ enabled: false }).where(inArray(channels.id, missingIds))
    removed = missingIds.length
  }

  // update last fetched
  await db.update(playlists)
    .set({ m3uLastFetchedAt: new Date().toISOString() })
    .where(eq(playlists.id, playlistId))

  return { added, updated, removed }
}

export async function ingestEPG(playlistId: number, content: Buffer, isGzip: boolean) {
  const xml = isGzip ? (await gunzip(content)).toString('utf-8') : content.toString('utf-8')
  fs.writeFileSync(rawEPGPath(playlistId), xml, 'utf-8')
  await db.update(playlists)
    .set({ epgLastFetchedAt: new Date().toISOString() })
    .where(eq(playlists.id, playlistId))
}

export async function refreshM3U(playlistId: number, triggeredBy: 'auto' | 'manual') {
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId))
  if (!playlist?.m3uUrl) throw new Error('No M3U URL configured')
  try {
    const content = await fetchText(playlist.m3uUrl)
    const delta = await ingestM3U(playlistId, content)
    await db.insert(refreshLog).values({
      playlistId,
      type: 'm3u',
      triggeredBy,
      status: 'success',
      detail: `+${delta.added} added, ${delta.updated} updated, ${delta.removed} removed`,
    })
    return delta
  } catch (e: any) {
    await db.insert(refreshLog).values({
      playlistId,
      type: 'm3u',
      triggeredBy,
      status: 'error',
      detail: e.message,
    })
    throw e
  }
}

export async function refreshEPG(playlistId: number, triggeredBy: 'auto' | 'manual') {
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId))
  if (!playlist?.epgUrl) throw new Error('No EPG URL configured')
  try {
    const buf = await fetchBinary(playlist.epgUrl)
    const isGzip = playlist.epgUrl.endsWith('.gz')
    await ingestEPG(playlistId, buf, isGzip)
    await db.insert(refreshLog).values({
      playlistId,
      type: 'epg',
      triggeredBy,
      status: 'success',
      detail: 'EPG refreshed',
    })
  } catch (e: any) {
    await db.insert(refreshLog).values({
      playlistId,
      type: 'epg',
      triggeredBy,
      status: 'error',
      detail: e.message,
    })
    throw e
  }
}
