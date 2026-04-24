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

function toAbsoluteUrl(value: string, upstream: URL) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  return new URL(value, upstream).toString()
}

function toProxyUrl(value: string, upstream: URL, baseUrl: string) {
  const absolute = toAbsoluteUrl(value, upstream)
  return `${baseUrl}/api/stream/segment?url=${encodeURIComponent(absolute)}`
}

function rewriteTagUriAttributes(line: string, upstream: URL, baseUrl: string) {
  return line.replace(/URI="([^"]+)"/g, (_match, value: string) => {
    return `URI="${toProxyUrl(value, upstream, baseUrl)}"`
  })
}

export function rewriteM3U8(text: string, upstreamUrl: string, baseUrl: string): string {
  const upstream = new URL(upstreamUrl)

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) return rewriteTagUriAttributes(line, upstream, baseUrl)

      return toProxyUrl(trimmed, upstream, baseUrl)
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

export async function toProxyResponse(upstream: Response, upstreamUrl: string, baseUrl: string) {
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
  return new Response(rewriteM3U8(text, upstreamUrl, baseUrl), { status: upstream.status, headers })
}
