export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { groups, channels } from '@/lib/schema'
import { eq } from 'drizzle-orm'

// Moves all channels from sourceId into targetId, then deletes sourceId
export async function POST(req: NextRequest) {
  const { targetId, sourceId } = await req.json()
  if (!targetId || !sourceId || targetId === sourceId) {
    return NextResponse.json({ error: 'Invalid group IDs' }, { status: 400 })
  }

  await db.update(channels).set({ groupId: targetId }).where(eq(channels.groupId, sourceId))
  await db.delete(groups).where(eq(groups.id, sourceId))

  return NextResponse.json({ ok: true })
}
