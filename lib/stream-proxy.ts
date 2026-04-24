export const HLS_TYPES = ['application/x-mpegurl', 'application/vnd.apple.mpegurl', 'audio/mpegurl']

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

export function rewriteM3U8(text: string, upstreamUrl: string, baseUrl: string): string {
  const upstream = new URL(upstreamUrl)

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line

      const absolute = trimmed.startsWith('http') ? trimmed : new URL(trimmed, upstream).toString()
      return `${baseUrl}/api/stream/segment?url=${encodeURIComponent(absolute)}`
    })
    .join('\n')
}

export async function toProxyResponse(upstream: Response, upstreamUrl: string, baseUrl: string) {
  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)

  const shouldInspectBody = isLikelyHLSContentType(contentType) || isLikelyHLSUrl(upstreamUrl)
  if (!shouldInspectBody) {
    return new Response(upstream.body, { status: upstream.status, headers })
  }

  const text = await upstream.text()
  if (!looksLikeHLSBody(text)) {
    return new Response(text, { status: upstream.status, headers })
  }

  return new Response(rewriteM3U8(text, upstreamUrl, baseUrl), { status: upstream.status, headers })
}
