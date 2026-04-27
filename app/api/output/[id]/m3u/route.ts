export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { playlists, groups, channels } from '@/lib/schema'
import { eq, asc, and } from 'drizzle-orm'
import { getPublicBaseUrl } from '@/lib/public-base-url'
import { channelPlaybackUrl } from '@/lib/stream-url'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const numericId = parseInt(id)
  const [playlist] = await db.select().from(playlists).where(
    isNaN(numericId) ? eq(playlists.slug, id) : eq(playlists.id, numericId)
  )
  if (!playlist) return new NextResponse('Not found', { status: 404 })
  const playlistId = playlist.id

  console.log(`[m3u] ${new Date().toISOString()} playlist=${playlist.name} id=${playlistId}`)

  const enabledGroups = await db.select().from(groups)
    .where(and(eq(groups.playlistId, playlistId), eq(groups.enabled, true)))
    .orderBy(asc(groups.sortOrder))

  const enabledChannels = await db.select().from(channels)
    .where(and(eq(channels.playlistId, playlistId), eq(channels.enabled, true), eq(channels.isDeleted, false)))
    .orderBy(asc(channels.sortOrder))

  const channelsByGroup = new Map<number, typeof enabledChannels>()
  for (const ch of enabledChannels) {
    if (!channelsByGroup.has(ch.groupId)) channelsByGroup.set(ch.groupId, [])
    channelsByGroup.get(ch.groupId)!.push(ch)
  }

  const baseUrl = getPublicBaseUrl(req)

  const epgUrl = playlist.epgUrl || playlist.epgSourceType === 'xtream' || playlist.epgLastFetchedAt
    ? (playlist.proxyEpg || playlist.epgSourceType === 'upload'
        ? `${baseUrl}/api/output/${playlist.slug}/xml`
        : playlist.epgUrl)
    : null

  const lines: string[] = [epgUrl ? `#EXTM3U x-tvg-url="${epgUrl}"` : '#EXTM3U']
  for (const g of enabledGroups) {
    const chs = channelsByGroup.get(g.id) ?? []
    for (const ch of chs) {
      const logo = ch.tvgLogo ? ` tvg-logo="${ch.tvgLogo}"` : ''
      const tvgId = ch.tvgId ? ` tvg-id="${ch.tvgId}"` : ''
      const streamUrl = channelPlaybackUrl(ch.id, ch.streamUrl, {
        baseUrl,
        playbackProfile: playlist.playbackProfile,
        proxyStreams: playlist.proxyStreams,
      })
      lines.push(`#EXTINF:-1${tvgId} tvg-name="${ch.displayName}"${logo} group-title="${g.displayName}",${ch.displayName}`)
      lines.push(streamUrl)
    }
  }

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'application/x-mpegurl',
      'Content-Disposition': `attachment; filename="${playlist.name}.m3u"`,
    },
  })
}
