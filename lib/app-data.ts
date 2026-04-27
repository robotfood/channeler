import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { channels, groups, playlists, refreshLog } from '@/lib/schema'

export async function getDashboardPlaylists() {
  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      slug: playlists.slug,
      m3uUrl: playlists.m3uUrl,
      m3uSourceType: playlists.m3uSourceType,
      xtreamServerUrl: playlists.xtreamServerUrl,
      xtreamUsername: playlists.xtreamUsername,
      xtreamOutput: playlists.xtreamOutput,
      m3uLastFetchedAt: playlists.m3uLastFetchedAt,
      epgUrl: playlists.epgUrl,
      epgSourceType: playlists.epgSourceType,
      epgLastFetchedAt: playlists.epgLastFetchedAt,
      autoRefresh: playlists.autoRefresh,
      m3uRefreshInterval: playlists.m3uRefreshInterval,
      epgRefreshInterval: playlists.epgRefreshInterval,
      bufferSize: playlists.bufferSize,
      playbackProfile: playlists.playbackProfile,
      proxyStreams: playlists.proxyStreams,
      proxyEpg: playlists.proxyEpg,
      createdAt: playlists.createdAt,
    })
    .from(playlists)
    .orderBy(playlists.createdAt)

  const [channelCounts, groupCounts] = await Promise.all([
    db.select({
      playlistId: channels.playlistId,
      total: sql<number>`count(*)`,
      enabled: sql<number>`sum(case when ${channels.enabled} and not ${channels.isDeleted} then 1 else 0 end)`,
      deleted: sql<number>`sum(case when ${channels.isDeleted} then 1 else 0 end)`,
    }).from(channels).groupBy(channels.playlistId),
    db.select({
      playlistId: groups.playlistId,
      count: sql<number>`count(*)`,
    }).from(groups).groupBy(groups.playlistId),
  ])

  const channelCountByPlaylist = new Map(channelCounts.map(row => [
    row.playlistId,
    {
      total: Number(row.total) || 0,
      enabled: Number(row.enabled) || 0,
      deleted: Number(row.deleted) || 0,
    },
  ]))
  const groupCountByPlaylist = new Map(groupCounts.map(row => [row.playlistId, Number(row.count) || 0]))

  return rows.map(p => {
    const channelCount = channelCountByPlaylist.get(p.id) ?? { total: 0, enabled: 0, deleted: 0 }
    return {
      ...p,
      channelTotal: channelCount.total,
      channelEnabled: channelCount.enabled,
      channelDeleted: channelCount.deleted,
      groupCount: groupCountByPlaylist.get(p.id) ?? 0,
    }
  })
}

export async function getPlaylistData(playlistId: number) {
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId))
  if (!playlist) return null

  const [playlistGroups, playlistChannels, playlistLog] = await Promise.all([
    db.select().from(groups)
      .where(eq(groups.playlistId, playlistId))
      .orderBy(asc(groups.sortOrder)),
    db.select().from(channels)
      .where(eq(channels.playlistId, playlistId))
      .orderBy(asc(channels.sortOrder)),
    db.select({
      id: refreshLog.id,
      playlistId: refreshLog.playlistId,
      playlistName: playlists.name,
      type: refreshLog.type,
      triggeredBy: refreshLog.triggeredBy,
      status: refreshLog.status,
      detail: refreshLog.detail,
      createdAt: refreshLog.createdAt,
    })
      .from(refreshLog)
      .leftJoin(playlists, eq(refreshLog.playlistId, playlists.id))
      .where(eq(refreshLog.playlistId, playlistId))
      .orderBy(desc(refreshLog.createdAt))
      .limit(20),
  ])

  return { ...playlist, groups: playlistGroups, channels: playlistChannels, log: playlistLog }
}

export async function getFavoriteChannels() {
  return await db.select({
    id: channels.id,
    displayName: channels.displayName,
    streamUrl: channels.streamUrl,
    tvgLogo: channels.tvgLogo,
    playlistId: channels.playlistId,
    proxyStreams: playlists.proxyStreams,
    bufferSize: playlists.bufferSize,
    playbackProfile: playlists.playbackProfile,
  })
    .from(channels)
    .innerJoin(playlists, eq(channels.playlistId, playlists.id))
    .where(and(
      eq(channels.isFavorite, true),
      eq(channels.isDeleted, false),
      eq(channels.enabled, true)
    ))
}

export type DashboardPlaylist = Awaited<ReturnType<typeof getDashboardPlaylists>>[number]
export type PlaylistData = NonNullable<Awaited<ReturnType<typeof getPlaylistData>>>
export type PlaylistSettingsData = Omit<PlaylistData, 'groups' | 'channels'>
