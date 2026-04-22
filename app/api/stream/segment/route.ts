export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

const CONNECT_TIMEOUT_MS = 10_000

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(url, { redirect: 'follow', signal: abort.signal })
  } catch (err: any) {
    clearTimeout(timer)
    const msg = err?.name === 'AbortError' ? 'Segment fetch timeout' : String(err)
    return new NextResponse(msg, { status: 502 })
  }
  clearTimeout(timer)

  if (!upstream.ok || !upstream.body) {
    return new NextResponse('Upstream error', { status: 502 })
  }

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)

  return new NextResponse(upstream.body, { status: 200, headers })
}
