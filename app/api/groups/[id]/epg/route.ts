export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channels } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { rawEPGPath } from '@/lib/playlist-ops'
import { parseXMLTVDate } from '@/lib/epg-parser'
import fs from 'fs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const groupId = parseInt(id)

  const groupChannels = await db.select().from(channels).where(eq(channels.groupId, groupId))
  if (groupChannels.length === 0) return NextResponse.json({})

  const playlistId = groupChannels[0].playlistId
  const epgPath = rawEPGPath(playlistId)
  if (!fs.existsSync(epgPath)) return NextResponse.json({})

  const raw = fs.readFileSync(epgPath, 'utf-8')
  
  // Map tvgId to channelId for quick lookup
  const tvgToChannelId = new Map<string, number>()
  for (const ch of groupChannels) {
    if (ch.tvgId) tvgToChannelId.set(ch.tvgId, ch.id)
  }

  const programmeRegex = /<programme\s+[^>]*start="([^"]*)"\s+[^>]*stop="([^"]*)"\s+[^>]*channel="([^"]*)"[^>]*>([\s\S]*?)<\/programme>/g
  
  const now = new Date()
  const currentEpg: Record<number, { title: string }> = {}

  let m: RegExpExecArray | null
  while ((m = programmeRegex.exec(raw)) !== null) {
    const [, startStr, stopStr, chId, content] = m
    const channelId = tvgToChannelId.get(chId)
    if (!channelId) continue

    const start = parseXMLTVDate(startStr)
    const stop = parseXMLTVDate(stopStr)

    if (now >= start && now < stop) {
      const titleMatch = /<title[^>]*>(.*?)<\/title>/.exec(content)
      if (titleMatch) {
        currentEpg[channelId] = {
          title: titleMatch[1]
        }
      }
    }
  }

  return NextResponse.json(currentEpg)
}
