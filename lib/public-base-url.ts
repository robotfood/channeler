import { NextRequest } from 'next/server'

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null
}

function stripTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function getPublicBaseUrl(req: NextRequest) {
  const configured = process.env.PUBLIC_BASE_URL?.trim()
  if (configured) return stripTrailingSlash(configured)

  const proto = firstHeaderValue(req.headers.get('x-forwarded-proto')) ?? req.nextUrl.protocol.replace(/:$/, '')
  const host = firstHeaderValue(req.headers.get('x-forwarded-host'))
    ?? firstHeaderValue(req.headers.get('host'))
    ?? req.nextUrl.host

  return `${proto}://${host}`
}
