'use client'

import ChannelPlayer from '@/components/channel-player'
import { channelPlaybackUrl } from '@/lib/stream-url'
import type { ChannelWithPlaylist } from '@/lib/app-data'

export default function WatchWindowClient({ channel }: { channel: ChannelWithPlaylist }) {
  return (
    <div className="h-screen">
      <ChannelPlayer
        key={channel.id}
        title={channel.displayName}
        channelId={channel.id}
        playlistId={channel.playlistId}
        bufferSize={channel.bufferSize}
        playbackProfile={channel.playbackProfile}
        transcodeBackend={channel.transcodeBackend}
        proxyStreams={channel.proxyStreams}
        initialFavorite={channel.isFavorite}
        url={channelPlaybackUrl(channel.id, channel.streamUrl, {
          playbackProfile: channel.playbackProfile,
          proxyStreams: channel.proxyStreams,
        })}
        onClose={() => window.close()}
      />
    </div>
  )
}
