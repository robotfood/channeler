import { NextRequest, NextResponse } from 'next/server'

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

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return new NextResponse(null, { status: 422 })
    }
    return new NextResponse(res.body, {
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
