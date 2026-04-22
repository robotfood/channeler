export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { playlists, groups, channels } from '@/lib/schema'
import { eq, sql } from 'drizzle-orm'
import { ingestM3U, ingestEPG, fetchText, fetchBinary } from '@/lib/playlist-ops'

export async function GET() {
  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      m3uUrl: playlists.m3uUrl,
      m3uSourceType: playlists.m3uSourceType,
      m3uLastFetchedAt: playlists.m3uLastFetchedAt,
      epgUrl: playlists.epgUrl,
      epgSourceType: playlists.epgSourceType,
      epgLastFetchedAt: playlists.epgLastFetchedAt,
      autoRefresh: playlists.autoRefresh,
      createdAt: playlists.createdAt,
    })
    .from(playlists)
    .orderBy(playlists.createdAt)

  // attach counts
  const result = await Promise.all(rows.map(async p => {
    const allChannels = await db.select({ enabled: channels.enabled })
      .from(channels).where(eq(channels.playlistId, p.id))
    const total = allChannels.length
    const enabled = allChannels.filter(c => c.enabled).length
    const groupCount = await db.select({ count: sql<number>`count(*)` })
      .from(groups).where(eq(groups.playlistId, p.id))
    return { ...p, channelTotal: total, channelEnabled: enabled, groupCount: groupCount[0].count }
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const name = formData.get('name') as string
  const m3uUrl = formData.get('m3uUrl') as string | null
  const m3uFile = formData.get('m3uFile') as File | null
  const epgUrl = formData.get('epgUrl') as string | null
  const epgFile = formData.get('epgFile') as File | null

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!m3uUrl && !m3uFile) return NextResponse.json({ error: 'M3U source required' }, { status: 400 })

  const [playlist] = await db.insert(playlists).values({
    name,
    m3uUrl: m3uUrl || null,
    m3uSourceType: m3uFile ? 'upload' : 'url',
    epgUrl: epgUrl || null,
    epgSourceType: epgFile ? 'upload' : epgUrl ? 'url' : null,
  }).returning()

  // ingest M3U
  let m3uContent: string
  if (m3uFile) {
    m3uContent = await m3uFile.text()
  } else {
    m3uContent = await fetchText(m3uUrl!)
  }
  await ingestM3U(playlist.id, m3uContent)

  // ingest EPG if provided
  if (epgFile) {
    const buf = Buffer.from(await epgFile.arrayBuffer())
    const isGzip = epgFile.name.endsWith('.gz')
    await ingestEPG(playlist.id, buf, isGzip)
  } else if (epgUrl) {
    const buf = await fetchBinary(epgUrl)
    const isGzip = epgUrl.endsWith('.gz')
    await ingestEPG(playlist.id, buf, isGzip)
  }

  return NextResponse.json({ id: playlist.id }, { status: 201 })
}
