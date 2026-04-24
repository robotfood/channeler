export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { refreshM3U } from '@/lib/playlist-ops'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const delta = await refreshM3U(parseInt(id), 'manual')
    return NextResponse.json(delta)
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })
  }
}
