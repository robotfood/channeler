export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { groups } from '@/lib/schema'
import { eq, inArray } from 'drizzle-orm'
import { writeDelta } from '@/lib/deltas'

// Body: { playlistId: number, orderedIds: number[] }
export async function POST(req: NextRequest) {
  const { playlistId, orderedIds } = await req.json()
  if (!playlistId || !Array.isArray(orderedIds)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const allGroups = await db.select().from(groups).where(inArray(groups.id, orderedIds))
  const byId = new Map(allGroups.map(g => [g.id, g]))

  const orderedNames = orderedIds.map(id => byId.get(id)?.originalName).filter(Boolean) as string[]
  await writeDelta(playlistId, { type: 'group_sort', orderedNames })

  await Promise.all(orderedIds.map((id, i) =>
    db.update(groups).set({ sortOrder: i }).where(eq(groups.id, id))
  ))

  return NextResponse.json({ ok: true })
}
