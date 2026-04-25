export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { playlists, groups, channels } from '@/lib/schema'
import { eq, asc } from 'drizzle-orm'
import { buildXtreamEpgUrl } from '@/lib/xtream'

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
  const [current] = await db.select().from(playlists).where(eq(playlists.id, playlistId))
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const updates: Record<string, string | boolean | null> = {}
  if ('name' in body) {
    updates.name = body.name
    updates.slug = (body.name as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playlist'
  }
  if ('m3uUrl' in body) updates.m3uUrl = body.m3uUrl
  if ('m3uSourceType' in body) updates.m3uSourceType = body.m3uSourceType
  if ('epgUrl' in body) updates.epgUrl = body.epgUrl
  if ('autoRefresh' in body) updates.autoRefresh = body.autoRefresh
  if ('proxyStreams' in body) updates.proxyStreams = body.proxyStreams
  if ('epgSourceType' in body) updates.epgSourceType = body.epgSourceType
  if ('xtreamServerUrl' in body) updates.xtreamServerUrl = body.xtreamServerUrl
  if ('xtreamUsername' in body) updates.xtreamUsername = body.xtreamUsername
  if ('xtreamPassword' in body) updates.xtreamPassword = body.xtreamPassword
  if ('xtreamOutput' in body) updates.xtreamOutput = body.xtreamOutput

  const nextM3uSourceType = updates.m3uSourceType ?? current.m3uSourceType
  const nextEpgSourceType = updates.epgSourceType ?? current.epgSourceType
  const nextXtreamServerUrl = updates.xtreamServerUrl ?? current.xtreamServerUrl
  const nextXtreamUsername = updates.xtreamUsername ?? current.xtreamUsername
  const nextXtreamPassword = updates.xtreamPassword ?? current.xtreamPassword

  if (nextM3uSourceType === 'xtream') updates.m3uUrl = null

  if (nextEpgSourceType === 'xtream' && nextXtreamServerUrl && nextXtreamUsername && nextXtreamPassword) {
    updates.epgUrl = buildXtreamEpgUrl({
      serverUrl: String(nextXtreamServerUrl),
      username: String(nextXtreamUsername),
      password: String(nextXtreamPassword),
    })
  }

  await db.update(playlists).set(updates).where(eq(playlists.id, playlistId))
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.delete(playlists).where(eq(playlists.id, parseInt(id)))
  return NextResponse.json({ ok: true })
}
