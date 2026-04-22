export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channels, playlists, refreshLog } from '@/lib/schema'
import { eq } from 'drizzle-orm'

const HLS_TYPES = ['application/x-mpegurl', 'application/vnd.apple.mpegurl', 'audio/mpegurl']
const CONNECT_TIMEOUT_MS = 10_000

function isHLS(contentType: string | null) {
  if (!contentType) return false
  return HLS_TYPES.some(t => contentType.toLowerCase().includes(t))
}

function rewriteM3U8(text: string, upstreamUrl: string, baseUrl: string): string {
  const base = new URL(upstreamUrl)
  return text.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const absolute = trimmed.startsWith('http') ? trimmed : new URL(trimmed, base).toString()
    return `${baseUrl}/api/stream/segment?url=${encodeURIComponent(absolute)}`
  }).join('\n')
}

async function logStream(playlistId: number, channelName: string, status: 'success' | 'error', detail?: string) {
  await db.insert(refreshLog).values({
    playlistId,
    type: 'stream',
    triggeredBy: 'player',
    status,
    detail: detail ?? channelName,
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const id = parseInt(channelId)

  const [channel] = await db.select().from(channels).where(eq(channels.id, id))
  if (!channel) return new NextResponse('Not found', { status: 404 })

  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, channel.playlistId))
  if (!playlist?.proxyStreams) return new NextResponse('Stream proxy not enabled for this playlist', { status: 403 })

  console.log(`[stream] ${new Date().toISOString()} channel=${channel.displayName} id=${id}`)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(channel.streamUrl, { redirect: 'follow', signal: abort.signal })
  } catch (err: any) {
    clearTimeout(timer)
    const detail = err?.name === 'AbortError' ? 'Connect timeout' : String(err)
    await logStream(playlist.id, channel.displayName, 'error', detail)
    return new NextResponse(detail, { status: 502 })
  }
  clearTimeout(timer)

  if (!upstream.ok || !upstream.body) {
    await logStream(playlist.id, channel.displayName, 'error', `Upstream ${upstream.status}`)
    return new NextResponse('Upstream error', { status: 502 })
  }

  const contentType = upstream.headers.get('content-type') ?? ''
  const headers = new Headers()
  if (contentType) headers.set('content-type', contentType)

  if (isHLS(contentType)) {
    const text = await upstream.text()
    const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`
    const rewritten = rewriteM3U8(text, channel.streamUrl, baseUrl)
    await logStream(playlist.id, channel.displayName, 'success')
    return new NextResponse(rewritten, { status: 200, headers })
  }

  await logStream(playlist.id, channel.displayName, 'success')
  return new NextResponse(upstream.body, { status: 200, headers })
}
