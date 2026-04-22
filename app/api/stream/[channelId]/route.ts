export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { channels, playlists } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const id = parseInt(channelId)

  const [channel] = await db.select().from(channels).where(eq(channels.id, id))
  if (!channel) return new NextResponse('Not found', { status: 404 })

  const [playlist] = await db.select().from(playlists).where(eq(playlists.id, channel.playlistId))
  if (!playlist?.proxyStreams) return new NextResponse('Stream proxy not enabled for this playlist', { status: 403 })

  console.log(`[stream] ${new Date().toISOString()} channel=${channel.displayName} id=${id}`)

  const upstream = await fetch(channel.streamUrl, { redirect: 'follow' })
  if (!upstream.ok || !upstream.body) {
    return new NextResponse('Upstream error', { status: 502 })
  }

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)

  return new NextResponse(upstream.body, { status: 200, headers })
}
