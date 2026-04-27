import { headers } from 'next/headers'
import { connection } from 'next/server'
import DashboardClient from '@/app/dashboard-client'
import { getDashboardPlaylists, getFavoriteChannels } from '@/lib/app-data'

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null
}

export default async function DashboardPage() {
  await connection()
  const headersList = await headers()
  const [playlists, favorites] = await Promise.all([
    getDashboardPlaylists(),
    getFavoriteChannels(),
  ])
  const host = firstHeaderValue(headersList.get('x-forwarded-host'))
    ?? firstHeaderValue(headersList.get('host'))
    ?? 'localhost:3000'

  return <DashboardClient initialPlaylists={playlists} favorites={favorites} host={host} />
}
