export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { groups } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { writeDelta } from '@/lib/deltas'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const groupId = parseInt(id)
  const body = await req.json()
  const updates: Record<string, string | boolean | number> = {}

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId))
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if ('displayName' in body) {
    updates.displayName = body.displayName
    await writeDelta(group.playlistId, { type: 'group_rename', originalName: group.originalName, displayName: body.displayName })
  }
  if ('enabled' in body) {
    updates.enabled = body.enabled
    await writeDelta(group.playlistId, { type: 'group_enabled', originalName: group.originalName, enabled: body.enabled })
  }
  if ('sortOrder' in body) {
    updates.sortOrder = body.sortOrder
  }

  await db.update(groups).set(updates).where(eq(groups.id, groupId))
  return NextResponse.json({ ok: true })
}
