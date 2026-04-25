import { headers } from 'next/headers'
import { connection } from 'next/server'
import DashboardClient from '@/app/dashboard-client'
import { getDashboardPlaylists } from '@/lib/app-data'

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null
}

export default async function DashboardPage() {
  await connection()
  const headersList = await headers()
  const playlists = await getDashboardPlaylists()
  const host = firstHeaderValue(headersList.get('x-forwarded-host'))
    ?? firstHeaderValue(headersList.get('host'))
    ?? 'localhost:3000'

  return <DashboardClient initialPlaylists={playlists} host={host} />
}
