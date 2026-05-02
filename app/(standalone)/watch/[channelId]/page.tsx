import { notFound } from 'next/navigation'
import { getChannelWithPlaylist } from '@/lib/app-data'
import WatchWindowClient from './watch-window-client'

export default async function WatchWindowPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const id = Number.parseInt(channelId, 10)
  if (Number.isNaN(id)) notFound()

  const channel = await getChannelWithPlaylist(id)
  if (!channel) notFound()

  return <WatchWindowClient channel={channel} />
}
