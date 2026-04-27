export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { listTranscodeSessions } from '@/lib/server-transcode'

export async function GET() {
  return NextResponse.json({ sessions: listTranscodeSessions() })
}
