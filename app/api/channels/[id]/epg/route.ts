export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channels } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { rawEPGPath } from '@/lib/playlist-ops'
import fs from 'fs'

// Helper to parse XMLTV dates like "20260426133000 +0000"
function parseXMLTVDate(xmltvDate: string): Date {
  const parts = xmltvDate.split(' ')
  const dateStr = parts[0]
  const year = parseInt(dateStr.slice(0, 4))
  const month = parseInt(dateStr.slice(4, 6)) - 1
  const day = parseInt(dateStr.slice(6, 8))
  const hour = parseInt(dateStr.slice(8, 10))
  const minute = parseInt(dateStr.slice(10, 12))
  const second = parseInt(dateStr.slice(12, 14)) || 0

  if (parts.length > 1) {
    const tz = parts[1]
    const sign = tz.startsWith('+') ? 1 : -1
    const tzHour = parseInt(tz.slice(1, 3))
    const tzMin = parseInt(tz.slice(3, 5))
    const offsetMs = sign * (tzHour * 60 + tzMin) * 60 * 1000
    
    // Create UTC date and then subtract the offset to get the actual UTC time
    const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second))
    return new Date(utcDate.getTime() - offsetMs)
  }

  return new Date(year, month, day, hour, minute, second)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const channelId = parseInt(id)

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId))
  if (!channel || !channel.tvgId) return new NextResponse('Not found', { status: 404 })

  const epgPath = rawEPGPath(channel.playlistId)
  if (!fs.existsSync(epgPath)) return new NextResponse('No EPG', { status: 404 })

  const raw = fs.readFileSync(epgPath, 'utf-8')
  
  // Extract programs for this channel
  const programmeRegex = /<programme\s+[^>]*start="([^"]*)"\s+[^>]*stop="([^"]*)"\s+[^>]*channel="([^"]*)"[^>]*>([\s\S]*?)<\/programme>/g
  
  const now = new Date()
  let currentProgram = null

  let m: RegExpExecArray | null
  while ((m = programmeRegex.exec(raw)) !== null) {
    const [, startStr, stopStr, chId, content] = m
    if (chId !== channel.tvgId) continue

    const start = parseXMLTVDate(startStr)
    const stop = parseXMLTVDate(stopStr)

    if (now >= start && now < stop) {
      const titleMatch = /<title[^>]*>(.*?)<\/title>/.exec(content)
      const descMatch = /<desc[^>]*>(.*?)<\/desc>/.exec(content)
      
      currentProgram = {
        title: titleMatch ? titleMatch[1] : 'No Title',
        desc: descMatch ? descMatch[1] : '',
        start: start.toISOString(),
        stop: stop.toISOString()
      }
      break
    }
  }

  if (!currentProgram) return new NextResponse('No current program', { status: 404 })

  return NextResponse.json(currentProgram)
}
