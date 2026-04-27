export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channels } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { writeDelta, channelKey } from '@/lib/deltas'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const channelId = parseInt(id)
  const body = await req.json()
  const updates: Record<string, string | boolean> = {}

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId))
  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const key = channelKey(channel)

  if ('displayName' in body) {
    updates.displayName = body.displayName
    await writeDelta(channel.playlistId, { type: 'channel_rename', channelKey: key, displayName: body.displayName })
  }
  if ('enabled' in body) {
    updates.enabled = body.enabled
    await writeDelta(channel.playlistId, { type: 'channel_enabled', channelKey: key, enabled: body.enabled })
  }
  if ('isDeleted' in body) {
    updates.isDeleted = body.isDeleted
    await writeDelta(channel.playlistId, { type: 'channel_deleted', channelKey: key, isDeleted: body.isDeleted })
  }
  if ('isFavorite' in body) {
    updates.isFavorite = body.isFavorite
    await writeDelta(channel.playlistId, { type: 'channel_favorite', channelKey: key, isFavorite: body.isFavorite })
  }

  await db.update(channels).set(updates).where(eq(channels.id, channelId))
  return NextResponse.json({ ok: true })
}
