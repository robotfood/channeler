export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { playlists, groups, channels } from '@/lib/schema'
import { eq, asc } from 'drizzle-orm'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const playlistId = parseInt(id)
  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId))
  if (!playlist) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gs = await db.select().from(groups)
    .where(eq(groups.playlistId, playlistId))
    .orderBy(asc(groups.sortOrder))

  const cs = await db.select().from(channels)
    .where(eq(channels.playlistId, playlistId))
    .orderBy(asc(channels.sortOrder))

  return NextResponse.json({ ...playlist, groups: gs, channels: cs })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const playlistId = parseInt(id)
  const body = await req.json()
  const updates: Record<string, any> = {}
  if ('name' in body) updates.name = body.name
  if ('m3uUrl' in body) updates.m3uUrl = body.m3uUrl
  if ('epgUrl' in body) updates.epgUrl = body.epgUrl
  if ('autoRefresh' in body) updates.autoRefresh = body.autoRefresh
  if ('proxyStreams' in body) updates.proxyStreams = body.proxyStreams
  if ('epgSourceType' in body) updates.epgSourceType = body.epgSourceType

  await db.update(playlists).set(updates).where(eq(playlists.id, playlistId))
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.delete(playlists).where(eq(playlists.id, parseInt(id)))
  return NextResponse.json({ ok: true })
}
