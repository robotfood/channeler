export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channels } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const updates: Record<string, any> = {}
  if ('displayName' in body) updates.displayName = body.displayName
  if ('enabled' in body) updates.enabled = body.enabled

  await db.update(channels).set(updates).where(eq(channels.id, parseInt(id)))
  return NextResponse.json({ ok: true })
}
