export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import fs from 'node:fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { channels, playlists } from '@/lib/schema'
import { ensureTranscodeSession, getTranscodeFilePath } from '@/lib/server-transcode'
import { usesTranscodedHls } from '@/lib/playback-profile'

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.aac': 'audio/aac',
}

function contentTypeFor(pathname: string) {
  const dotIndex = pathname.lastIndexOf('.')
  const ext = dotIndex >= 0 ? pathname.slice(dotIndex).toLowerCase() : ''
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ channelId: string; path: string[] }> }) {
  const { channelId, path } = await params
  const id = parseInt(channelId)
  if (!Number.isFinite(id)) return new NextResponse('Invalid channel id', { status: 400 })

  const [channel] = await db.select().from(channels).where(eq(channels.id, id))
  if (!channel) return new NextResponse('Not found', { status: 404 })

  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, channel.playlistId))
  if (!playlist || !usesTranscodedHls(playlist.playbackProfile)) {
    return new NextResponse('Server HLS profile is not enabled for this playlist', { status: 403 })
  }

  try {
    await ensureTranscodeSession(channel, playlist)
    const filePath = getTranscodeFilePath(channel.id, playlist.playbackProfile, path)
    const data = await fs.readFile(filePath)
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': filePath.endsWith('.m3u8') ? 'no-store, no-cache, must-revalidate' : 'public, max-age=30',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('ENOENT') ? 404 : 502
    return new NextResponse(message, { status })
  }
}
