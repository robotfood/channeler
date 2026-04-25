import { connection } from 'next/server'
import SettingsClient from '@/app/settings/settings-client'
import { getSettingsData } from '@/lib/app-data'

export default async function SettingsPage() {
  await connection()
  const data = await getSettingsData()
  return <SettingsClient initialData={data} />
}
