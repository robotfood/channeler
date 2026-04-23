export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { groups, channels } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { writeDelta } from '@/lib/deltas'

export async function POST(req: NextRequest) {
  const { targetId, sourceId } = await req.json()
  if (!targetId || !sourceId || targetId === sourceId) {
    return NextResponse.json({ error: 'Invalid group IDs' }, { status: 400 })
  }

  const [target] = await db.select().from(groups).where(eq(groups.id, targetId))
  const [source] = await db.select().from(groups).where(eq(groups.id, sourceId))
  if (!target || !source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await writeDelta(target.playlistId, { type: 'group_merge', targetName: target.originalName, sourceName: source.originalName })

  await db.update(channels).set({ groupId: targetId }).where(eq(channels.groupId, sourceId))
  await db.delete(groups).where(eq(groups.id, sourceId))

  return NextResponse.json({ ok: true })
}
