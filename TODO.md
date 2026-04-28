# TODO

## Stream Proxy

Add support for proxying video streams through the container (useful when the container is on a VPN):

- Add a `/api/stream/[channelId]` route that fetches the stream from the source and pipes it to the client
- Rewrite stream URLs in the output M3U to point to the proxy route when enabled
- Add a per-playlist setting to enable/disable stream proxying
- Surface the toggle in the playlist settings UI

## ~~GitHub Actions CI/CD~~ ✅

Set up a GitHub Actions workflow that triggers on push to `main`:

- [x] Generate a build number (e.g. `YYYYMMDD-<short-sha>`)
- [x] Build a multi-arch Docker image (`linux/amd64` + `linux/arm64`)
- [x] Push to Docker Hub as `emmettmoore/channeler:<build-number>` and `emmettmoore/channeler:latest`
- [x] Use registry-based layer caching to keep builds fast

## Up Next

- [x] Add per-playlist buffer settings (small, medium, large, xl)
- [x] Add auto-reconnect support in the video player for dropped streams
- [x] Implement connection multiplexing/sharing to avoid hitting IPTV max connection limits
- [x] Add server playback profiles for stable HLS and FFmpeg transcoding
- [x] Add optional 60fps motion interpolation playback profiles
- [x] Add clean/sharp/sports non-AI enhancement playback profiles
- [x] Add Intel QSV H.264 playback profiles
- [x] Add hardware backend selection for Intel QSV and Apple VideoToolbox
- [x] Add experimental hardware 4K playback profile
- [ ] Fix Intel QSV probe on Xeon/Unraid Docker when `/dev/dri` is passed through but FFmpeg reports unsupported picture structure/resolution/pixel format and falls back to CPU
- [ ] Add hardware-accelerated VAAPI transcode mode and host capability checks
- [ ] Add transcode session dashboard with current process/client health
