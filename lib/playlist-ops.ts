import { db, dataPath } from './db'
import { playlists, groups, channels, refreshLog } from './schema'
import { applyDeltas } from './deltas'
import { parseM3U, type ParsedChannel } from './m3u-parser'
import {
  buildXtreamEpgUrl,
  buildXtreamLiveStreamUrl,
  buildXtreamPlayerApiUrl,
  hasXtreamCredentials,
  type XtreamCategory,
  type XtreamCredentials,
  type XtreamLiveStream,
  type XtreamPlayerApiResponse,
} from './xtream'
import { eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { promisify } from 'util'

const gunzip = promisify(zlib.gunzip)

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

export async function fetchBinary(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.json() as Promise<T>
}

export function validateM3UContent(content: string) {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error('Source returned an empty playlist')
  }

  const looksLikeM3U = trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXTINF:')
  if (!looksLikeM3U) {
    const preview = trimmed.slice(0, 200).replace(/\s+/g, ' ')
    throw new Error(`Source did not return a valid M3U playlist: ${preview}`)
  }
}

export function rawM3UPath(id: number) {
  return path.join(dataPath, 'raw', `${id}.m3u`)
}

export function rawEPGPath(id: number) {
  return path.join(dataPath, 'raw', `${id}.xml`)
}

function renderM3U(channels: ParsedChannel[]): string {
  const lines = ['#EXTM3U']

  for (const channel of channels) {
    const attrs = [
      `tvg-id="${channel.tvgId || ''}"`,
      `tvg-name="${channel.tvgName || ''}"`,
      `tvg-logo="${channel.tvgLogo || ''}"`,
      `group-title="${channel.groupTitle || ''}"`,
    ].join(' ')
    lines.push(`#EXTINF:-1 ${attrs},${channel.displayName}`)
    lines.push(channel.streamUrl)
  }

  return lines.join('\n')
}

function countValues(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed) counts.set(trimmed, (counts.get(trimmed) || 0) + 1)
  }
  return counts
}

function buildSourceKey(channel: ParsedChannel, tvgIdCounts: Map<string, number>) {
  const tvgId = channel.tvgId.trim()
  if (tvgId && tvgIdCounts.get(tvgId) === 1) return `tvg:${tvgId}`
  if (channel.sourceKey?.trim()) return channel.sourceKey.trim()
  return `url:${channel.streamUrl.trim()}`
}

async function ingestChannels(playlistId: number, parsed: ParsedChannel[], rawContent?: string) {
  if (rawContent) {
    fs.writeFileSync(rawM3UPath(playlistId), rawContent, 'utf-8')
  }

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
  const existingBySourceKey = new Map(existingChannels.filter(c => c.sourceKey).map(c => [c.sourceKey!, c]))
  const existingByTvgId = new Map(existingChannels.filter(c => c.tvgId).map(c => [c.tvgId!, c]))
  const existingByTvgName = new Map(existingChannels.filter(c => c.tvgName).map(c => [c.tvgName, c]))
  const existingByDisplayName = new Map(existingChannels.map(c => [c.displayName, c]))
  const tvgIdCounts = countValues(parsed.map(c => c.tvgId))

  let added = 0
  let updated = 0
  const seenIds = new Set<number>()

  for (let i = 0; i < parsed.length; i++) {
    const ch = parsed[i]
    const groupId = groupIdMap.get(ch.groupTitle)
    if (!groupId) continue
    const tvgId = ch.tvgId.trim()
    const sourceKey = buildSourceKey(ch, tvgIdCounts)

    const existing =
      existingBySourceKey.get(sourceKey) ||
      (tvgId && tvgIdCounts.get(tvgId) === 1 && existingByTvgId.get(tvgId)) ||
      (ch.tvgName && existingByTvgName.get(ch.tvgName)) ||
      existingByDisplayName.get(ch.displayName)

    if (existing) {
      seenIds.add(existing.id)
      await db.update(channels)
        .set({
          streamUrl: ch.streamUrl,
          groupId,
          tvgId: ch.tvgId || null,
          tvgName: ch.tvgName,
          tvgLogo: ch.tvgLogo,
          sourceKey,
          sortOrder: i,
        })
        .where(eq(channels.id, existing.id))
      updated++
    } else {
      const [inserted] = await db.insert(channels).values({
        playlistId,
        groupId,
        tvgId: ch.tvgId || null,
        tvgName: ch.tvgName,
        tvgLogo: ch.tvgLogo,
        sourceKey,
        displayName: ch.displayName,
        streamUrl: ch.streamUrl,
        enabled: true,
        sortOrder: i,
      }).returning()
      seenIds.add(inserted.id)
      added++
    }
  }

  const missingIds = existingChannels.map(c => c.id).filter(id => !seenIds.has(id))
  const removed = missingIds.length

  await db.update(playlists)
    .set({ m3uLastFetchedAt: new Date().toISOString() })
    .where(eq(playlists.id, playlistId))

  await applyDeltas(playlistId)

  return { added, updated, removed }
}

export async function ingestM3U(playlistId: number, content: string) {
  validateM3UContent(content)
  const parsed = parseM3U(content)
  return ingestChannels(playlistId, parsed, content)
}

function isXtreamAuthenticated(response: XtreamPlayerApiResponse) {
  const auth = response.user_info?.auth
  return auth === 1 || auth === '1' || auth === true
}

function normalizeXtreamLiveChannels(
  creds: XtreamCredentials,
  account: XtreamPlayerApiResponse,
  categories: XtreamCategory[],
  streams: XtreamLiveStream[]
): ParsedChannel[] {
  const categoryMap = new Map(
    categories.map(category => [String(category.category_id), category.category_name || 'Uncategorized'])
  )

  return streams.map(stream => {
    const tvgId = stream.epg_channel_id ? String(stream.epg_channel_id) : ''
    const displayName = stream.name || `Stream ${stream.stream_id}`
    const groupTitle = stream.category_id != null
      ? (categoryMap.get(String(stream.category_id)) || 'Uncategorized')
      : 'Uncategorized'

    return {
      tvgId,
      tvgName: displayName,
      tvgLogo: stream.stream_icon || '',
      groupTitle,
      displayName,
      sourceKey: `xtream:${stream.stream_id}`,
      streamUrl: buildXtreamLiveStreamUrl(creds, account.server_info, stream.stream_id),
    }
  })
}

export async function ingestXtreamLive(playlistId: number, creds: XtreamCredentials) {
  const account = await fetchJson<XtreamPlayerApiResponse>(buildXtreamPlayerApiUrl(creds))
  if (!isXtreamAuthenticated(account)) {
    throw new Error(account.user_info?.message || 'Xtream login failed')
  }

  const [categories, streams] = await Promise.all([
    fetchJson<XtreamCategory[]>(buildXtreamPlayerApiUrl(creds, 'get_live_categories')),
    fetchJson<XtreamLiveStream[]>(buildXtreamPlayerApiUrl(creds, 'get_live_streams')),
  ])

  if (!Array.isArray(categories)) {
    throw new Error('Xtream API did not return live categories')
  }
  if (!Array.isArray(streams)) {
    throw new Error('Xtream API did not return live streams')
  }

  const normalized = normalizeXtreamLiveChannels(creds, account, categories, streams)
  if (normalized.length === 0) {
    throw new Error('Xtream API returned no live streams')
  }

  return ingestChannels(playlistId, normalized, renderM3U(normalized))
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
  if (!playlist) throw new Error('Playlist not found')

  try {
    const delta = playlist.m3uSourceType === 'xtream' && hasXtreamCredentials(playlist)
      ? await ingestXtreamLive(playlistId, {
          serverUrl: playlist.xtreamServerUrl!,
          username: playlist.xtreamUsername!,
          password: playlist.xtreamPassword!,
          output: playlist.xtreamOutput,
        })
      : playlist.m3uUrl
        ? await ingestM3U(playlistId, await fetchText(playlist.m3uUrl))
        : (() => { throw new Error('No M3U source configured') })()

    await db.insert(refreshLog).values({
      playlistId,
      type: 'm3u',
      triggeredBy,
      status: 'success',
      detail: `+${delta.added} added, ${delta.updated} updated, ${delta.removed} removed`,
    })
    return delta
  } catch (error: unknown) {
    await db.insert(refreshLog).values({
      playlistId,
      type: 'm3u',
      triggeredBy,
      status: 'error',
      detail: getErrorMessage(error),
    })
    throw error
  }
}

export async function refreshEPG(playlistId: number, triggeredBy: 'auto' | 'manual') {
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId))
  if (!playlist) throw new Error('Playlist not found')

  const sourceUrl = playlist.epgSourceType === 'xtream' && hasXtreamCredentials(playlist)
    ? buildXtreamEpgUrl({
        serverUrl: playlist.xtreamServerUrl!,
        username: playlist.xtreamUsername!,
        password: playlist.xtreamPassword!,
      })
    : playlist.epgUrl

  if (!sourceUrl) throw new Error('No EPG source configured')

  try {
    const buf = await fetchBinary(sourceUrl)
    const isGzip = sourceUrl.endsWith('.gz')
    await ingestEPG(playlistId, buf, isGzip)
    await db.insert(refreshLog).values({
      playlistId,
      type: 'epg',
      triggeredBy,
      status: 'success',
      detail: 'EPG refreshed',
    })
  } catch (error: unknown) {
    await db.insert(refreshLog).values({
      playlistId,
      type: 'epg',
      triggeredBy,
      status: 'error',
      detail: getErrorMessage(error),
    })
    throw error
  }
}
