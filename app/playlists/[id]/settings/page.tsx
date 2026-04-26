import { notFound } from 'next/navigation'
import PlaylistSettingsClient from '@/app/playlists/[id]/settings/playlist-settings-client'
import { getPlaylistData, type PlaylistData } from '@/lib/app-data'

function toPlaylistSettings(data: PlaylistData) {
  return {
    id: data.id,
    name: data.name,
    m3uUrl: data.m3uUrl,
    m3uSourceType: data.m3uSourceType,
    xtreamServerUrl: data.xtreamServerUrl,
    xtreamUsername: data.xtreamUsername,
    xtreamPassword: data.xtreamPassword,
    xtreamOutput: data.xtreamOutput,
    m3uLastFetchedAt: data.m3uLastFetchedAt,
    epgUrl: data.epgUrl,
    epgSourceType: data.epgSourceType,
    epgLastFetchedAt: data.epgLastFetchedAt,
    slug: data.slug,
    autoRefresh: data.autoRefresh,
    proxyStreams: data.proxyStreams,
    proxyEpg: data.proxyEpg,
    createdAt: data.createdAt,
  }
}

export default async function PlaylistSettingsPage(props: PageProps<'/playlists/[id]/settings'>) {
  const { id } = await props.params
  const playlistId = Number.parseInt(id, 10)
  if (Number.isNaN(playlistId)) notFound()

  const data = await getPlaylistData(playlistId)
  if (!data) notFound()

  return <PlaylistSettingsClient initialData={toPlaylistSettings(data)} playlistId={id} />
}
