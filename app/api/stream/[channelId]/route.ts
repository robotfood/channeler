export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channels, playlists, refreshLog } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { toProxyResponse } from '@/lib/stream-proxy'
import { getPublicBaseUrl } from '@/lib/public-base-url'
const CONNECT_TIMEOUT_MS = 10_000

async function logStream(playlistId: number, channelName: string, status: 'success' | 'error', detail?: string) {
  const msg = detail ?? channelName
  console.log(`[stream] ${new Date().toISOString()} channel=${channelName} status=${status}${detail ? ` detail=${detail}` : ''}`)
  await db.insert(refreshLog).values({
    playlistId,
    type: 'stream',
    triggeredBy: 'player',
    status,
    detail: msg,
  })
}

function errorDetail(err: unknown) {
  if (err instanceof Error) {
    return err.name === 'AbortError' ? 'Connect timeout' : err.message
  }
  return String(err)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const id = parseInt(channelId)

  const [channel] = await db.select().from(channels).where(eq(channels.id, id))
  if (!channel) return new NextResponse('Not found', { status: 404 })

  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, channel.playlistId))
  if (!playlist?.proxyStreams) return new NextResponse('Stream proxy not enabled for this playlist', { status: 403 })

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(channel.streamUrl, { redirect: 'follow', signal: abort.signal })
  } catch (err: unknown) {
    clearTimeout(timer)
    const detail = errorDetail(err)
    await logStream(playlist.id, channel.displayName, 'error', detail)
    return new NextResponse(detail, { status: 502 })
  }
  clearTimeout(timer)

  if (!upstream.ok || !upstream.body) {
    await logStream(playlist.id, channel.displayName, 'error', `Upstream ${upstream.status}`)
    return new NextResponse('Upstream error', { status: 502 })
  }

  const baseUrl = getPublicBaseUrl(req)
  await logStream(playlist.id, channel.displayName, 'success')
  return toProxyResponse(upstream, channel.streamUrl, baseUrl)
}
