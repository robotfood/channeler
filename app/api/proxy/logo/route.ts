export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { dataPath } from '@/lib/data-path'

const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_BYTES = 5 * 1024 * 1024

type CacheMeta = {
  status: number
  contentType: string
  cachedAt: number
  negative?: boolean
}

const EMPTY_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>'
)

function cacheKey(url: string) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

function cachePaths(url: string) {
  const key = cacheKey(url)
  const dir = path.join(dataPath, 'logo-cache')
  return {
    dir,
    bodyPath: path.join(dir, `${key}.body`),
    metaPath: path.join(dir, `${key}.json`),
  }
}

function cacheControlFor(status: number, negative = false) {
  const maxAge = status === 200 && !negative ? Math.floor(POSITIVE_TTL_MS / 1000) : Math.floor(NEGATIVE_TTL_MS / 1000)
  return `public, max-age=${maxAge}, immutable`
}

async function readCachedLogo(url: string) {
  const { bodyPath, metaPath } = cachePaths(url)
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as CacheMeta
    const ttl = meta.status === 200 && !meta.negative ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
    if (Date.now() - meta.cachedAt > ttl) return null

    if (meta.status !== 200 || meta.negative) {
      return new NextResponse(EMPTY_LOGO, {
        status: 200,
        headers: {
          'content-type': 'image/svg+xml',
          'cache-control': cacheControlFor(200, true),
          'x-channeler-cache': 'negative-hit',
        },
      })
    }

    const body = await fs.readFile(bodyPath)
    return new NextResponse(body, {
      headers: {
        'content-type': meta.contentType,
        'cache-control': cacheControlFor(200),
        'x-channeler-cache': 'hit',
      },
    })
  } catch {
    return null
  }
}

async function writeCachedLogo(url: string, meta: CacheMeta, body?: ArrayBuffer | Uint8Array) {
  const { dir, bodyPath, metaPath } = cachePaths(url)
  await fs.mkdir(dir, { recursive: true })
  if (body && body.byteLength <= MAX_CACHE_BYTES) {
    const buffer = body instanceof ArrayBuffer ? Buffer.from(body) : Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    await fs.writeFile(bodyPath, buffer)
  }
  await fs.writeFile(metaPath, JSON.stringify(meta))
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse(null, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new NextResponse(null, { status: 400 })
  }

  const cached = await readCachedLogo(url)
  if (cached) return cached

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      await writeCachedLogo(url, { status: 200, contentType: 'image/svg+xml', cachedAt: Date.now(), negative: true }, EMPTY_LOGO)
      return new NextResponse(EMPTY_LOGO, {
        status: 200,
        headers: {
          'content-type': 'image/svg+xml',
          'cache-control': cacheControlFor(200, true),
          'x-channeler-cache': 'negative-miss',
        },
      })
    }

    const body = await res.arrayBuffer()
    await writeCachedLogo(url, { status: 200, contentType, cachedAt: Date.now() }, body)
    return new NextResponse(body, {
      headers: {
        'content-type': contentType,
        'cache-control': cacheControlFor(200),
        'x-channeler-cache': 'miss',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
