export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { toProxyResponse } from '@/lib/stream-proxy'

const CONNECT_TIMEOUT_MS = 10_000

function errorDetail(err: unknown) {
  if (err instanceof Error) {
    return err.name === 'AbortError' ? 'Segment fetch timeout' : err.message
  }
  return String(err)
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(url, { redirect: 'follow', signal: abort.signal })
  } catch (err: unknown) {
    clearTimeout(timer)
    const msg = errorDetail(err)
    console.log(`[segment] ${new Date().toISOString()} error=${msg} url=${url}`)
    return new NextResponse(msg, { status: 502 })
  }
  clearTimeout(timer)

  if (!upstream.ok || !upstream.body) {
    console.log(`[segment] ${new Date().toISOString()} error=upstream-${upstream.status} url=${url}`)
    return new NextResponse('Upstream error', { status: 502 })
  }

  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`
  return toProxyResponse(upstream, url, baseUrl)
}
