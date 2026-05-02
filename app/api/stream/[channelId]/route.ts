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

  const ffmpegProcess = spawnMpegtsStream(channel, playlist)

  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      function close() {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // Ignore if the client already disconnected.
        }
      }

      req.signal.addEventListener('abort', () => {
        if (ffmpegProcess.exitCode === null) ffmpegProcess.kill('SIGTERM')
      }, { once: true })

      ffmpegProcess.stdout.on('data', (chunk) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
          if ((controller.desiredSize ?? 1) <= 0) ffmpegProcess.stdout.pause()
        } catch {
          closed = true
          if (ffmpegProcess.exitCode === null) ffmpegProcess.kill('SIGTERM')
        }
      })
      ffmpegProcess.stdout.on('end', close)
      ffmpegProcess.stdout.on('error', (err) => {
        if (!closed) controller.error(err)
        closed = true
      })
      
      ffmpegProcess.stderr.on('data', (chunk) => {
        // Log errors but don't stop the stream unless critical
        const msg = chunk.toString().trim()
        if (msg) console.error(`[stream] channel=${id} ffmpeg: ${msg}`)
      })

      ffmpegProcess.on('exit', (code, signal) => {
        console.log(`[stream] channel=${id} ffmpeg exit code=${code} signal=${signal}`)
        close()
      })
    },
    pull() {
      if (!closed && ffmpegProcess.stdout.isPaused()) ffmpegProcess.stdout.resume()
    },
    cancel() {
      closed = true
      console.log(`[stream] channel=${id} client disconnected, killing ffmpeg pid=${ffmpegProcess.pid}`)
      ffmpegProcess.kill('SIGTERM')
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
