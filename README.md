# Channeler

Self-hosted web app for managing M3U IPTV playlists. Import playlists from a URL or file, filter/rename groups and channels, then point your IPTV player at the output proxy URLs.

## Features

- Import M3U playlists by URL or file upload
- Attach an EPG (XMLTV) source per playlist by URL or file upload
- Enable/disable groups and individual channels
- Rename groups and channels (double-click to edit inline)
- Drag to reorder groups
- Filtered M3U and EPG served as live proxy URLs for any IPTV player on your network
- Auto-refresh on a schedule (1h / 6h / 12h / 24h / 7d)
- Optional server playback profiles for proxying, stable HLS remuxing, and FFmpeg-based transcoding
- Refresh log showing history of all fetches

## Quick start (Docker)

```bash
docker build -t channeler .

docker run -d \
  -p 3000:3000 \
  -v /your/host/path/data:/app/data \
  -e PUBLIC_BASE_URL=http://192.168.50.4:3000 \
  --name channeler \
  channeler
```

Open [http://localhost:3000](http://localhost:3000).

If stream proxying is enabled and clients need to reach this app on your LAN or through a reverse proxy, set `PUBLIC_BASE_URL` to the externally reachable base URL so generated proxy stream URLs use the correct address.

Server playback profiles that remux or transcode streams require FFmpeg. The Docker image uses a Debian slim runtime with FFmpeg plus Intel media packages for VAAPI/QSV. If you run the app outside Docker, install FFmpeg and make sure `ffmpeg` is on `PATH`, or set `FFMPEG_PATH=/path/to/ffmpeg`. Hardware profiles use each playlist's Hardware Backend setting: `auto`, `vaapi`, `qsv`, `videotoolbox`, or `cpu`. Intel Linux/Unraid containers should usually use `auto` or `vaapi` with `/dev/dri` passed through. On Apple hardware, use `videotoolbox`; FFmpeg exposes Apple hardware H.264 through VideoToolbox rather than a separate Metal encoder.

For Intel QSV in Docker/Unraid, pass the render device into the container:

```bash
docker run -d \
  --device /dev/dri:/dev/dri \
  -e TRANSCODE_BACKEND=auto \
  -p 3000:3000 \
  -v /your/host/path/data:/app/data \
  --name channeler \
  channeler
```

When `/dev/dri` is present, the container runs a startup Intel hardware diagnostic and logs whether FFmpeg can complete 720p `h264_vaapi` and `h264_qsv` validation encodes. To force the check manually inside a running container:

```bash
docker exec channeler channeler-qsv-check
```

## Server playback profiles

Playback profiles control whether clients receive the original stream, a proxied stream, or a server-generated HLS stream. Any mode except Direct routes video through Channeler.

| Profile | What it does | Ideal buffer | CPU load | GPU load | Best use |
|---|---|---|---:|---:|---|
| Direct source | Sends clients to the provider URL directly | Medium | None | None | Lowest latency and no server work |
| Proxy passthrough | Proxies the original stream through Channeler | Medium | Very low | None | VPN routing, hiding provider URL, connection sharing |
| Stable HLS remux | Uses FFmpeg to repackage into local HLS without re-encoding when possible | Large | Low | None | Better stability and client compatibility with minimal quality loss |
| Transcode 720p | CPU transcodes to H.264/AAC 720p HLS | Large | Medium | None | Weak clients, lower bandwidth, normalizing odd streams |
| Transcode 1080p | CPU transcodes to H.264/AAC 1080p HLS | Large | High | None | Client compatibility at higher resolution |
| Hardware 720p | Hardware H.264 encode to 720p HLS using QSV, Apple VideoToolbox, or CPU fallback | Large | Low to medium | Medium | Hardware-assisted 720p transcode |
| Hardware 1080p | Hardware H.264 encode to 1080p HLS using QSV, Apple VideoToolbox, or CPU fallback | Large | Medium | Medium to high | Hardware-assisted 1080p transcode |
| Hardware 4K | Hardware H.264 encode to 2160p HLS using QSV, Apple VideoToolbox, or CPU fallback | XL | Medium to high | High | Higher-bitrate 4K output for capable local clients |
| Enhanced 1080p | Deinterlaces, scales, sharpens, then CPU transcodes | Large | High | None | General quality improvement for soft/interlaced channels |
| Clean 1080p | Deinterlaces, denoises, lightly sharpens, then CPU transcodes | Large | High | None | Noisy or blocky low-bitrate channels |
| Deinterlace 720p60 | Converts interlaced field motion to 60 fps output at 720p | XL | High | Low to medium | True interlaced sports/news feeds where field-rate motion matters |
| Deinterlace 1080p60 | Heavy field-rate deinterlace for true 1080i feeds | XL | Very high | Medium to high | Only for stable high-bitrate 1080i feeds on capable servers |
| Sports 720p60 | Field-rate deinterlaces to 720p60 with sharpening and hardware detail/denoise where supported | XL | High | Medium | Sports channels on QSV/VAAPI systems |
| Hardware Sports 720p60 | Hardware deinterlaces and encodes 720p60 with QSV detail/denoise where supported | XL | Medium | Medium | Best first try for sports on Intel QSV systems |

On the Xeon E3-1245 v6 / Intel HD Graphics P630, start with Stable HLS, Hardware 720p, Enhanced 1080p, and Sports 720p60 for sports. Treat Hardware 4K and Deinterlace 1080p60 as experimental because they can be bandwidth-heavy or CPU-heavy depending on the stream.

The buffer setting controls the steady-state playback buffer, not a long startup wait. The player starts close to the live edge and then fills the selected buffer size in the background. Server-generated HLS uses short 2-second segments to reduce channel-change delay while still allowing larger buffers for unstable or CPU-heavy profiles.

Audio processing is separate from the video profile. Standard AAC re-encodes audio for compatibility with a light normalization pass while preserving the source channel layout. Enhanced 5.1 applies stronger dynamic normalization and a more aggressive surround upmix using FFmpeg's `surround` filter; it pushes stereo harder into a 5.1 field and is best used only when you want that processed sound.

## Data storage

All data lives in the volume at `/app/data`:

```
/app/data/
  db.sqlite        # channel settings, groups, preferences
  raw/
    1.m3u          # cached raw M3U for playlist id 1
    1.xml          # cached EPG XML for playlist id 1
```

Mount a host directory there so data survives container restarts.

## IPTV player setup

After adding a playlist, copy the output URLs from the dashboard:

| Type | URL |
|---|---|
| M3U | `http://<your-server-ip>:3000/api/output/<id>/m3u` |
| EPG | `http://<your-server-ip>:3000/api/output/<id>/xml` |

Enter these in your IPTV player (Infuse, TiviMate, Channels DVR, IPTV Smarters, etc.). The app serves only the channels you've enabled, with any renames applied. Stream URLs are passed through directly — your player connects to the source, not through this server.

## Development

```bash
npm install
npm run dev
```

Runs on [http://localhost:3000](http://localhost:3000). Data is stored in `./data/` by default.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATA_PATH` | `./data` | Path to SQLite DB and raw cache files |
| `PORT` | `3000` | Port to listen on |
| `PUBLIC_BASE_URL` | unset | External base URL used when generating proxied stream URLs, e.g. `http://your-server:3000` |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg binary used by server playback profiles |
| `TRANSCODE_BACKEND` | `auto` | Default hardware profile backend for playlists that use Auto: `auto`, `vaapi`, `qsv`, `amf`, `videotoolbox`, or `cpu` |
| `TRANSCODE_RENDER_DEVICE` | `/dev/dri/renderD128` | Linux render device used by VAAPI/QSV container diagnostics and FFmpeg hardware initialization |
| `TRANSCODE_QSV_DEVICE` | unset | Deprecated alias for `TRANSCODE_RENDER_DEVICE` |
| `TRANSCODE_RECOMMENDED_BACKEND` | set at runtime | App-populated recommendation from short FFmpeg hardware encode probes |
| `TRANSCODE_RECOMMENDED_ENCODER` | set at runtime | FFmpeg encoder selected by the runtime probe, such as `h264_vaapi`, `h264_qsv`, `h264_amf`, `h264_videotoolbox`, or `libx264` |
| `TRANSCODE_THREADS` | `0` | FFmpeg thread count for transcode/filter work. `0` lets FFmpeg auto-size; set a number to cap CPU use |
| `TRANSCODE_TEST_AUDIO_PROFILE` | `standard` | Audio profile used by the transcode smoke test: `standard` or `enhanced_5_1` |
| `CHANNELER_RUN_QSV_CHECK` | `false` | Force the Docker startup QSV diagnostic even when `/dev/dri` is not detected |
| `CHANNELER_SKIP_CONTAINER_CHECKS` | `false` | Skip Docker startup diagnostics |

### Transcode backends

Each playlist can choose a Hardware Backend in settings. `TRANSCODE_BACKEND` is only the server default behind Auto. These backend choices only affect Hardware playback profiles. CPU-only profiles such as Enhanced and Clean still use FFmpeg software filters and `libx264`.

| Backend | What it uses | Best for | Notes |
|---|---|---|---|
| `auto` | Runs short FFmpeg test encodes for hardware backends, then falls back to CPU | Default deployments | Prefers VideoToolbox on macOS and VAAPI on Linux when those probes pass |
| `vaapi` | Linux VAAPI via FFmpeg `h264_vaapi` | Intel iGPU Docker/Unraid hosts with `/dev/dri` passed through | Best first choice for Xeon E3 / Intel P630 Linux containers when QSV rejects the runtime parameters |
| `qsv` | Intel Quick Sync via FFmpeg `h264_qsv` | Intel iGPU servers and Unraid hosts with `/dev/dri` passed through | Best match for Xeon E3-1245 v6 / Intel P630 |
| `amf` | AMD AMF via FFmpeg `h264_amf` | Hosts with supported AMD GPU encode access | Requires an FFmpeg build with AMF plus the host GPU/runtime exposed to the app |
| `videotoolbox` | Apple VideoToolbox via FFmpeg `h264_videotoolbox` | macOS hosts and Apple Silicon | This is the practical Apple hardware encoder path; it is not exposed as a separate Metal encoder in FFmpeg |
| `cpu` | FFmpeg `libx264` software encoding | Debugging or hosts without hardware encoder access | Most compatible, but highest CPU usage |

### Transcode profile smoke test

Run the real FFmpeg profile test on the machine or container that will do transcoding:

```bash
npm run test:transcode
```

The test uses synthetic video/audio, generates HLS output for each playback profile, and reports pass/fail/skip for hardware backends. By default it skips the slowest 4K and 1080p60 checks. Use `-- --all` to include them:

```bash
npm run test:transcode -- --all
```

Useful options:

| Option / env var | Example | Description |
|---|---|---|
| `--backends=` / `TRANSCODE_TEST_BACKENDS` | `qsv,videotoolbox,cpu` | Limit hardware backend combinations |
| `--profiles=` / `TRANSCODE_TEST_PROFILES` | `qsv_720p,hardware_smooth_720p60` | Limit playback profiles |
| `--audio-profile=` / `TRANSCODE_TEST_AUDIO_PROFILE` | `enhanced_5_1` | Test standard AAC or enhanced 5.1 audio processing |
| `--keep-output` | | Keep generated HLS files under `/tmp` for inspection |
| `FFMPEG_PATH` | `/usr/local/bin/ffmpeg` | Test a specific FFmpeg binary |
| `TRANSCODE_TEST_DURATION` | `8` | Number of seconds of synthetic media per test |
| `TRANSCODE_TEST_TIMEOUT_MS` | `120000` | Per-profile FFmpeg timeout |

## Xtream Integration Test

You can test the native Xtream import path against a real provider without touching your app data.

1. Copy `.env.xtream.example` to `.env.xtream.local`

```bash
cp .env.xtream.example .env.xtream.local
```

2. Fill in the Xtream credentials in `.env.xtream.local`:

```env
TEST_XTREAM_SERVER_URL=http://your-provider.example
TEST_XTREAM_USERNAME=your-username
TEST_XTREAM_PASSWORD=your-password
TEST_XTREAM_OUTPUT=ts
TEST_XTREAM_TEST_EPG=true
```

3. Run the integration test:

```bash
npm run test:xtream
```

4. Optional:
- Set `TEST_XTREAM_OUTPUT=m3u8` to validate `m3u8` live stream URLs
- Set `TEST_XTREAM_TEST_EPG=false` if you only want to test live TV import
- Set `ENV_FILE=/path/to/custom.env` to use a different env file

The test:
- creates a temporary `DATA_PATH`
- runs migrations
- inserts a temporary Xtream-backed playlist
- syncs live categories and streams through `player_api.php`
- verifies channels/groups were imported
- runs a refresh pass
- optionally fetches and caches XMLTV when `TEST_XTREAM_TEST_EPG=true`

Notes:
- Some IPTV providers only allow API access from specific regions or networks. If the test fails while the credentials are known-good, you may need to connect through the same VPN or network location you use in your IPTV app.
- The test uses a temporary database and raw cache directory under your system temp folder, so it does not modify your normal `./data` folder.

Sample successful output:

```text
$ npm run test:xtream

> channeler@0.1.0 test:xtream
> node --import tsx tests/xtream-integration.ts

Env file: /Users/emmett/projects/channeler/.env.xtream.local
Temp DATA_PATH: /var/folders/3y/c09w7pb53m93qls9rtpy5tg80000gn/T/channeler-xtream-test-8Ewhzk
Imported groups: 870
Imported channels: 52995
Initial ingest: +52995 added, 0 updated, 0 removed
Refresh ingest: +0 added, 52995 updated, 4688 removed
EPG verified: yes
```
