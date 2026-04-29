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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readFileWithSegmentWait(filePath: string, isRunning: () => boolean) {
  const isSegment = filePath.endsWith('.ts') || filePath.endsWith('.m4s') || filePath.endsWith('.aac')
  const deadline = Date.now() + (isSegment ? 20_000 : 0)

  while (true) {
    try {
      return await fs.readFile(filePath)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' || !isSegment || !isRunning() || Date.now() >= deadline) throw err
      await sleep(250)
    }
  }
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
    const session = await ensureTranscodeSession(channel, playlist)
    const filePath = getTranscodeFilePath(channel.id, playlist.playbackProfile, playlist.transcodeBackend, playlist.audioProfile, path)
    const data = await readFileWithSegmentWait(filePath, () => session.process.exitCode === null)
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': filePath.endsWith('.m3u8') ? 'no-store, no-cache, must-revalidate' : 'public, max-age=30',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('ENOENT') ? 404 : 502
    console.error(`[transcode] channel=${channel.id} profile=${playlist.playbackProfile} status=${status} error=${message}`)
    return new NextResponse(message, { status })
  }
}
