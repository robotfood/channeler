import { notFound } from 'next/navigation'
import PlaylistEditorClient from './playlist-editor-client'
import { getPlaylistData } from '@/lib/app-data'

export default async function PlaylistEditorPage(props: PageProps<'/playlists/[id]'>) {
  const { id } = await props.params
  const playlistId = Number.parseInt(id, 10)
  if (Number.isNaN(playlistId)) notFound()

  const data = await getPlaylistData(playlistId)
  if (!data) notFound()

  return <PlaylistEditorClient initialData={data} playlistId={id} />
}
