export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { refreshEPG } from '@/lib/playlist-ops'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await refreshEPG(parseInt(id), 'manual')
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
