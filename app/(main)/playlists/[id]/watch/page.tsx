import { notFound } from 'next/navigation'
import WatchClient from './watch-client'
import { getPlaylistData } from '@/lib/app-data'

export default async function WatchPage(props: PageProps<'/playlists/[id]/watch'>) {
  const { id } = await props.params
  const playlistId = Number.parseInt(id, 10)
  if (Number.isNaN(playlistId)) notFound()

  const data = await getPlaylistData(playlistId)
  if (!data) notFound()

  return <WatchClient initialData={data} />
}
