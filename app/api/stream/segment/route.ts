export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  buildUpstreamRequestHeaders,
  countSetCookieHeaders,
  deriveProxyContext,
  logProxyDebug,
  readProxyContext,
  summarizeUrl,
  toProxyResponse,
} from '@/lib/stream-proxy'
import { getPublicBaseUrl } from '@/lib/public-base-url'

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
  const requestContext = readProxyContext(req.nextUrl.searchParams)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), CONNECT_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(url, {
      redirect: 'follow',
      signal: abort.signal,
      headers: buildUpstreamRequestHeaders(req, requestContext),
    })
  } catch (err: unknown) {
    clearTimeout(timer)
    const msg = errorDetail(err)
    console.log(`[segment] ${new Date().toISOString()} error=${msg} url=${url}`)
    return new NextResponse(msg, { status: 502 })
  }
  clearTimeout(timer)

  logProxyDebug('segment-debug', {
    requestUrl: summarizeUrl(url),
    finalUrl: summarizeUrl(upstream.url || url),
    status: upstream.status,
    contentType: upstream.headers.get('content-type') ?? undefined,
    cacheControl: upstream.headers.get('cache-control') ?? undefined,
    setCookieCount: countSetCookieHeaders(upstream.headers),
    hasCookieContext: Boolean(requestContext.cookie),
    referer: requestContext.referer ? summarizeUrl(requestContext.referer) : undefined,
    origin: requestContext.origin ?? undefined,
    requestRange: req.headers.get('range') ?? undefined,
  })

  if (!upstream.ok || !upstream.body) {
    console.log(`[segment] ${new Date().toISOString()} error=upstream-${upstream.status} url=${url}`)
    return new NextResponse('Upstream error', { status: 502 })
  }

  const baseUrl = getPublicBaseUrl(req)
  const proxyContext = deriveProxyContext(url, upstream, requestContext)
  return toProxyResponse(upstream, url, baseUrl, proxyContext)
}
