export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { settings } from '@/lib/schema'
import { reloadScheduler } from '@/lib/scheduler'
import { getSettingsData } from '@/lib/app-data'

export async function GET() {
  return NextResponse.json(await getSettingsData())
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
