export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { stopTranscodeSessionsForChannel } from '@/lib/server-transcode'

export async function POST(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const id = parseInt(channelId, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 })

  return NextResponse.json({
    ok: true,
    stopped: stopTranscodeSessionsForChannel(id),
  })
}
