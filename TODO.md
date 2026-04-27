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

- [ ] Add per-playlist buffer settings (small, medium, large, xl)
- [ ] Add auto-reconnect support in the video player for dropped streams
- [ ] Implement connection multiplexing/sharing to avoid hitting IPTV max connection limits
