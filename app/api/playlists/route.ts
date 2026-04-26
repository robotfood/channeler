export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { playlists } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { ingestM3U, ingestEPG, fetchText, fetchBinary, ingestXtreamLive } from '@/lib/playlist-ops'
import { buildXtreamEpgUrl } from '@/lib/xtream'
import { getDashboardPlaylists } from '@/lib/app-data'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function GET() {
  return NextResponse.json(await getDashboardPlaylists())
}

export async function POST(req: NextRequest) {
  let createdPlaylistId: number | null = null

  try {
    const formData = await req.formData()
    const name = formData.get('name') as string
    const sourceKind = (formData.get('sourceKind') as string | null) ?? 'm3u'
    const m3uUrl = formData.get('m3uUrl') as string | null
    const m3uFile = formData.get('m3uFile') as File | null
    const epgUrl = formData.get('epgUrl') as string | null
    const epgFile = formData.get('epgFile') as File | null
    const xtreamServerUrl = formData.get('xtreamServerUrl') as string | null
    const xtreamUsername = formData.get('xtreamUsername') as string | null
    const xtreamPassword = formData.get('xtreamPassword') as string | null
    const xtreamOutput = (formData.get('xtreamOutput') as string | null) || 'ts'
    const useXtreamEpg = (formData.get('useXtreamEpg') as string | null) === 'true'
    const proxyEpg = (formData.get('proxyEpg') as string | null) !== 'false'

    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (sourceKind === 'xtream') {
      if (!xtreamServerUrl || !xtreamUsername || !xtreamPassword) {
        return NextResponse.json({ error: 'Xtream server URL, username, and password are required' }, { status: 400 })
      }
    } else if (!m3uUrl && !m3uFile) {
      return NextResponse.json({ error: 'M3U source required' }, { status: 400 })
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playlist'
    const normalizedXtreamServerUrl = xtreamServerUrl?.trim() || null
    const normalizedXtreamUsername = xtreamUsername?.trim() || null
    const normalizedXtreamPassword = xtreamPassword?.trim() || null
    const builtXtreamEpgUrl = sourceKind === 'xtream' && useXtreamEpg
      ? buildXtreamEpgUrl({
          serverUrl: normalizedXtreamServerUrl!,
          username: normalizedXtreamUsername!,
          password: normalizedXtreamPassword!,
        })
      : null

    const [playlist] = await db.insert(playlists).values({
      name,
      slug,
      m3uUrl: sourceKind === 'xtream' ? null : m3uUrl || null,
      m3uSourceType: sourceKind === 'xtream' ? 'xtream' : m3uFile ? 'upload' : 'url',
      xtreamServerUrl: normalizedXtreamServerUrl,
      xtreamUsername: normalizedXtreamUsername,
      xtreamPassword: normalizedXtreamPassword,
      xtreamOutput: sourceKind === 'xtream' ? xtreamOutput : null,
      epgUrl: sourceKind === 'xtream' ? builtXtreamEpgUrl : epgUrl || null,
      epgSourceType: sourceKind === 'xtream'
        ? useXtreamEpg ? 'xtream' : null
        : epgFile ? 'upload' : epgUrl ? 'url' : null,
      proxyEpg,
    }).returning()
    createdPlaylistId = playlist.id

    if (sourceKind === 'xtream') {
      await ingestXtreamLive(playlist.id, {
        serverUrl: normalizedXtreamServerUrl!,
        username: normalizedXtreamUsername!,
        password: normalizedXtreamPassword!,
        output: xtreamOutput,
      })
    } else if (m3uFile) {
      await ingestM3U(playlist.id, await m3uFile.text())
    } else {
      await ingestM3U(playlist.id, await fetchText(m3uUrl!))
    }

    if (epgFile) {
      const buf = Buffer.from(await epgFile.arrayBuffer())
      const isGzip = epgFile.name.endsWith('.gz')
      await ingestEPG(playlist.id, buf, isGzip)
    } else if (sourceKind === 'xtream' && useXtreamEpg) {
      const buf = await fetchBinary(builtXtreamEpgUrl!)
      const isGzip = builtXtreamEpgUrl!.endsWith('.gz')
      await ingestEPG(playlist.id, buf, isGzip)
    } else if (epgUrl) {
      const buf = await fetchBinary(epgUrl)
      const isGzip = epgUrl.endsWith('.gz')
      await ingestEPG(playlist.id, buf, isGzip)
    }

    return NextResponse.json({ id: playlist.id }, { status: 201 })
  } catch (error: unknown) {
    if (createdPlaylistId !== null) {
      await db.delete(playlists).where(eq(playlists.id, createdPlaylistId))
    }

    const message = getErrorMessage(error)
    const status = (
      message.includes('valid M3U playlist') ||
      message.includes('empty playlist') ||
      message.includes('Xtream') ||
      message.includes('login failed')
    ) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
