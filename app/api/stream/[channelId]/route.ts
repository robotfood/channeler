export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { channels, playlists } from '@/lib/schema'
import { spawnMpegtsStream } from '@/lib/server-stream'

export async function GET(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const id = parseInt(channelId)
  if (!Number.isFinite(id)) return new NextResponse('Invalid channel id', { status: 400 })

  const [channel] = await db.select().from(channels).where(eq(channels.id, id))
  if (!channel) return new NextResponse('Not found', { status: 404 })

  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, channel.playlistId))
  if (!playlist) return new NextResponse('Playlist not found', { status: 404 })

  const process = spawnMpegtsStream(channel, playlist)

  const stream = new ReadableStream({
    start(controller) {
      process.stdout.on('data', (chunk) => controller.enqueue(chunk))
      process.stdout.on('end', () => controller.close())
      process.stdout.on('error', (err) => controller.error(err))
      
      process.stderr.on('data', (chunk) => {
        // Log errors but don't stop the stream unless critical
        const msg = chunk.toString().trim()
        if (msg) console.error(`[stream] channel=${id} ffmpeg: ${msg}`)
      })

      process.on('exit', (code, signal) => {
        console.log(`[stream] channel=${id} ffmpeg exit code=${code} signal=${signal}`)
        try {
          controller.close()
        } catch {
          // Ignore if already closed
        }
      })
    },
    cancel() {
      console.log(`[stream] channel=${id} client disconnected, killing ffmpeg pid=${process.pid}`)
      process.kill('SIGTERM')
    }
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
    },
  })
}
