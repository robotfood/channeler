export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { settings, refreshLog, playlists } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { reloadScheduler } from '@/lib/scheduler'

export async function GET() {
  const rows = await db.select().from(settings)
  const log = await db.select({
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
    .orderBy(desc(refreshLog.createdAt))
    .limit(50)

  return NextResponse.json({ settings: Object.fromEntries(rows.map(r => [r.key, r.value])), log })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Record<string, string>
  for (const [key, value] of Object.entries(body)) {
    await db.insert(settings).values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
  }
  await reloadScheduler()
  return NextResponse.json({ ok: true })
}
