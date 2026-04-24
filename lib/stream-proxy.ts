export const HLS_TYPES = ['application/x-mpegurl', 'application/vnd.apple.mpegurl', 'audio/mpegurl']

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
])

export type ProxyContext = {
  cookie?: string
  origin?: string
  referer?: string
  userAgent?: string
}

function isProxyDebugEnabled() {
  const value = process.env.STREAM_PROXY_DEBUG?.trim().toLowerCase()
  return value === 'true'
}

export function countSetCookieHeaders(headers: Headers) {
  return getSetCookieHeaders(headers).length
}

export function summarizeUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value
  }
}

export function logProxyDebug(scope: string, details: Record<string, string | number | boolean | undefined>) {
  if (!isProxyDebugEnabled()) return
  const parts = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
  console.log(`[${scope}] ${new Date().toISOString()} ${parts.join(' ')}`)
}

export function isLikelyHLSContentType(contentType: string | null) {
  if (!contentType) return false
  const lower = contentType.toLowerCase()
  return HLS_TYPES.some(type => lower.includes(type))
}

export function isLikelyHLSUrl(url: string) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8')
  } catch {
    return false
  }
}

export function looksLikeHLSBody(text: string) {
  return text.trimStart().startsWith('#EXTM3U')
}

export function readProxyContext(searchParams: URLSearchParams): ProxyContext {
  return {
    cookie: searchParams.get('cookie') ?? undefined,
    origin: searchParams.get('origin') ?? undefined,
    referer: searchParams.get('referer') ?? undefined,
    userAgent: searchParams.get('ua') ?? undefined,
  }
}

function appendCookieValue(cookieHeader: string | undefined, cookies: Map<string, string>) {
  if (!cookieHeader) return
  for (const part of cookieHeader.split(';')) {
    const segment = part.trim()
    if (!segment) continue
    const equalsIndex = segment.indexOf('=')
    if (equalsIndex <= 0) continue
    const name = segment.slice(0, equalsIndex).trim()
    const value = segment.slice(equalsIndex + 1).trim()
    if (!name) continue
    cookies.set(name, value)
  }
}

function appendSetCookieValue(setCookieHeader: string, cookies: Map<string, string>) {
  const firstSegment = setCookieHeader.split(';', 1)[0]?.trim()
  if (!firstSegment) return
  const equalsIndex = firstSegment.indexOf('=')
  if (equalsIndex <= 0) return
  const name = firstSegment.slice(0, equalsIndex).trim()
  const value = firstSegment.slice(equalsIndex + 1).trim()
  if (!name) return
  cookies.set(name, value)
}

function getSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }

  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

export function buildUpstreamRequestHeaders(req: Request, context: ProxyContext = {}) {
  const headers = new Headers()
  const userAgent = context.userAgent ?? req.headers.get('user-agent')
  if (userAgent) headers.set('user-agent', userAgent)
  if (context.referer) headers.set('referer', context.referer)
  if (context.origin) headers.set('origin', context.origin)
  if (context.cookie) headers.set('cookie', context.cookie)

  const range = req.headers.get('range')
  if (range) headers.set('range', range)

  const accept = req.headers.get('accept')
  if (accept) headers.set('accept', accept)

  return headers
}

export function deriveProxyContext(upstreamUrl: string, upstream: Response, inherited: ProxyContext = {}): ProxyContext {
  const upstreamUrlObject = new URL(upstreamUrl)
  const cookies = new Map<string, string>()
  appendCookieValue(inherited.cookie, cookies)
  for (const setCookieHeader of getSetCookieHeaders(upstream.headers)) {
    appendSetCookieValue(setCookieHeader, cookies)
  }

  const cookie = cookies.size > 0
    ? Array.from(cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ')
    : undefined

  return {
    cookie,
    origin: upstreamUrlObject.origin,
    referer: upstreamUrl,
    userAgent: inherited.userAgent,
  }
}

function toAbsoluteUrl(value: string, upstream: URL) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  return new URL(value, upstream).toString()
}

function toProxyUrl(value: string, upstream: URL, baseUrl: string, context: ProxyContext) {
  const absolute = toAbsoluteUrl(value, upstream)
  const params = new URLSearchParams({ url: absolute })
  if (context.cookie) params.set('cookie', context.cookie)
  if (context.origin) params.set('origin', context.origin)
  if (context.referer) params.set('referer', context.referer)
  if (context.userAgent) params.set('ua', context.userAgent)
  return `${baseUrl}/api/stream/segment?${params.toString()}`
}

function rewriteTagUriAttributes(line: string, upstream: URL, baseUrl: string, context: ProxyContext) {
  return line.replace(/URI="([^"]+)"/g, (_match, value: string) => {
    return `URI="${toProxyUrl(value, upstream, baseUrl, context)}"`
  })
}

export function rewriteM3U8(text: string, upstreamUrl: string, baseUrl: string, context: ProxyContext): string {
  const upstream = new URL(upstreamUrl)

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) return rewriteTagUriAttributes(line, upstream, baseUrl, context)

      return toProxyUrl(trimmed, upstream, baseUrl, context)
    })
    .join('\n')
}

function copyResponseHeaders(upstream: Response) {
  const headers = new Headers()
  for (const [key, value] of upstream.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue
    headers.set(key, value)
  }
  return headers
}

export async function toProxyResponse(upstream: Response, upstreamUrl: string, baseUrl: string, context: ProxyContext = {}) {
  const headers = copyResponseHeaders(upstream)
  const contentType = upstream.headers.get('content-type')
  const shouldInspectBody = isLikelyHLSContentType(contentType) || isLikelyHLSUrl(upstreamUrl)
  if (!shouldInspectBody) {
    return new Response(upstream.body, { status: upstream.status, headers })
  }

  const text = await upstream.text()
  if (!looksLikeHLSBody(text)) {
    headers.set('cache-control', 'no-store, no-cache, must-revalidate')
    headers.set('pragma', 'no-cache')
    headers.set('expires', '0')
    return new Response(text, { status: upstream.status, headers })
  }

  headers.set('cache-control', 'no-store, no-cache, must-revalidate')
  headers.set('pragma', 'no-cache')
  headers.set('expires', '0')
  return new Response(rewriteM3U8(text, upstreamUrl, baseUrl, context), { status: upstream.status, headers })
}
