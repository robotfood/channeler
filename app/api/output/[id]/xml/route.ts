export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { playlists, channels } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { rawEPGPath } from '@/lib/playlist-ops'
import fs from 'fs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const numericId = parseInt(id)
  const [playlist] = await db.select().from(playlists).where(
    isNaN(numericId) ? eq(playlists.slug, id) : eq(playlists.id, numericId)
  )
  if (!playlist) return new NextResponse('Not found', { status: 404 })
  const playlistId = playlist.id

  const epgPath = rawEPGPath(playlistId)
  if (!fs.existsSync(epgPath)) {
    return new NextResponse('No EPG data available', { status: 404 })
  }

  const enabledChannels = await db.select({ tvgId: channels.tvgId })
    .from(channels)
    .where(and(eq(channels.playlistId, playlistId), eq(channels.enabled, true), eq(channels.isDeleted, false)))
  const enabledIds = new Set(enabledChannels.map(c => c.tvgId).filter(Boolean))

  // Stream-filter the XML: keep <channel> and <programme> elements whose id/channel attr is in enabledIds
  const raw = fs.readFileSync(epgPath, 'utf-8')
  const filtered = filterXMLTV(raw, enabledIds as Set<string>)

  return new NextResponse(filtered, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}

function filterXMLTV(xml: string, ids: Set<string>): string {
  // Regex-based filter — avoids pulling in a full XML parser dependency
  const channelRegex = /<channel\s[^>]*id="([^"]*)"[^>]*>[\s\S]*?<\/channel>/g
  const programmeRegex = /<programme\s[^>]*channel="([^"]*)"[^>]*>[\s\S]*?<\/programme>/g

  const channels: string[] = []
  const programmes: string[] = []

  let m: RegExpExecArray | null
  while ((m = channelRegex.exec(xml)) !== null) {
    if (ids.has(m[1])) channels.push(m[0])
  }
  while ((m = programmeRegex.exec(xml)) !== null) {
    if (ids.has(m[1])) programmes.push(m[0])
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n${channels.join('\n')}\n${programmes.join('\n')}\n</tv>`
}
