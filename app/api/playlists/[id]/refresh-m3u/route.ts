export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { refreshM3U } from '@/lib/playlist-ops'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const delta = await refreshM3U(parseInt(id), 'manual')
    return NextResponse.json(delta)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
