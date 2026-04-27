export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getTranscodeHardwareRecommendation, listTranscodeSessions } from '@/lib/server-transcode'

export async function GET() {
  return NextResponse.json({
    recommendedBackend: getTranscodeHardwareRecommendation(),
    sessions: listTranscodeSessions(),
  })
}
