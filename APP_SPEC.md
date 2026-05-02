# Channeler — Current App Spec

## Overview

Channeler is a self-hosted web app for managing M3U IPTV playlists and optional XMLTV EPG sources. It imports a source playlist, stores the raw files locally, lets the user rename, enable, disable, reorder, and merge groups and channels, then serves a filtered M3U and filtered EPG for use in external IPTV players.

The app is an editor and output generator, not a player. In the default mode, stream URLs are passed through directly to the IPTV client. A playlist can also opt into stream proxying through this server.

---

## Stack

- Framework: Next.js 16 App Router
- UI: React 19
- Database: SQLite via `node:sqlite`
- Query layer: `drizzle-orm`
- Styling: Tailwind CSS 4
- Scheduling: in-process `setInterval`
- Deployment target: Docker or local Node runtime

---

## Core Concepts

| Term | Meaning |
|---|---|
| Playlist | One imported M3U source plus optional EPG source |
| Group | The M3U `group-title` bucket used to organize channels |
| Channel | A parsed `#EXTINF` entry plus its stream URL |
| EPG source | An XMLTV `.xml` or `.xml.gz` source file |
| Output M3U | The filtered playlist served by Channeler |
| Output XML | The filtered XMLTV served by Channeler |
| Delta | A persisted user edit that is replayed after source refreshes |

---

## Data Storage

All app data lives under `DATA_PATH` and defaults to `./data`.

```text
data/
  db.sqlite
  raw/
    <playlist-id>.m3u
    <playlist-id>.xml
```

The raw source files are cached on disk. Structured state and user edits are stored in SQLite.

---

## Data Model

### `playlists`

| column | type | notes |
|---|---|---|
| id | integer PK | autoincrement |
| name | text | user-facing playlist name |
| m3u_url | text | nullable |
| m3u_source_type | text | `url` or `upload` |
| m3u_last_fetched_at | text | ISO timestamp, nullable |
| epg_url | text | nullable |
| epg_source_type | text | `url`, `upload`, or null |
| epg_last_fetched_at | text | ISO timestamp, nullable |
| slug | text | URL-friendly identifier used by output routes |
| auto_refresh | boolean | whether this playlist participates in global auto-refresh |
| proxy_streams | boolean | whether output M3U points at local stream proxy URLs |
| created_at | text | SQLite datetime string |

### `groups`

| column | type | notes |
|---|---|---|
| id | integer PK | autoincrement |
| playlist_id | integer FK | cascade delete |
| original_name | text | original source group name |
| display_name | text | editable label used in output |
| enabled | boolean | controls inclusion in output |
| sort_order | integer | UI and output ordering |

### `channels`

| column | type | notes |
|---|---|---|
| id | integer PK | autoincrement |
| playlist_id | integer FK | cascade delete |
| group_id | integer FK | cascade delete |
| tvg_id | text | nullable |
| tvg_name | text | nullable |
| tvg_logo | text | nullable |
| display_name | text | editable channel name |
| stream_url | text | upstream stream URL |
| enabled | boolean | controls inclusion in output |
| sort_order | integer | source ordering |

### `settings`

| column | type | notes |
|---|---|---|
| key | text PK | |
| value | text | |

Expected keys:
- `m3u_auto_refresh_enabled`
- `m3u_refresh_interval_seconds`
- `epg_auto_refresh_enabled`
- `epg_refresh_interval_seconds`

### `deltas`

Stores durable user edits so they can be replayed after a playlist refresh.

| column | type | notes |
|---|---|---|
| id | integer PK | autoincrement |
| playlist_id | integer FK | cascade delete |
| type | text | delta type |
| payload | text | JSON payload |
| created_at | text | SQLite datetime string |

Current delta types:
- `group_rename`
- `group_enabled`
- `group_sort`
- `group_merge`
- `channel_rename`
- `channel_enabled`

### `refresh_log`

| column | type | notes |
|---|---|---|
| id | integer PK | autoincrement |
| playlist_id | integer FK | nullable |
| type | text | `m3u`, `epg`, or `stream` |
| triggered_by | text | `auto`, `manual`, or `player` |
| status | text | `success` or `error` |
| detail | text | human-readable result or error |
| created_at | text | SQLite datetime string |

---

## Main Pages

### `/` Dashboard

Shows all playlists as cards with:
- playlist name
- enabled channel count vs total channel count
- group count
- last M3U refresh timestamp
- output URLs for M3U and EPG
- actions for edit, settings, and delete

The dashboard exposes output URLs using the playlist slug:
- `/api/output/<slug>/m3u`
- `/api/output/<slug>/xml`

### `/playlists/new`

Creates a playlist from:
- M3U URL or uploaded `.m3u` / `.m3u8` file
- optional EPG URL or uploaded `.xml` / `.xml.gz` file

On create:
1. A playlist row is inserted with a generated slug.
2. The M3U is fetched or read from upload.
3. The playlist is parsed into groups and channels.
4. The optional EPG is fetched or read from upload and cached.
5. The user is redirected to the playlist editor.

### `/playlists/[id]`

Playlist editor with:
- searchable group list
- group enable and disable toggles
- inline group renaming
- drag-and-drop group sorting
- group merge flow
- searchable channel list within the selected group
- channel enable and disable toggles
- inline channel renaming
- manual refresh buttons for M3U and EPG when corresponding URLs exist

### `/playlists/[id]/settings`

Per-playlist settings for:
- playlist name
- M3U URL
- EPG URL
- include in global auto-refresh
- proxy streams through this server
- delete playlist

Notes:
- Changing the playlist name also regenerates the slug.
- For uploaded playlists, adding a URL later enables scheduled refreshes.
- The current settings UI shows an "Upload new EPG file" control, but the backend route it calls performs a URL-based refresh rather than accepting a file upload.

### `/settings`

Global settings page for:
- enabling or disabling M3U auto-refresh
- enabling or disabling EPG auto-refresh
- selecting refresh intervals
- viewing the last 50 refresh log entries

---

## API Surface

### Playlist management

| method | path | action |
|---|---|---|
| `GET` | `/api/playlists` | list playlists with counts and metadata |
| `POST` | `/api/playlists` | create playlist from URL or uploaded files |
| `GET` | `/api/playlists/[id]` | fetch one playlist with groups and channels |
| `PATCH` | `/api/playlists/[id]` | update name, URLs, auto-refresh, proxy setting, and some source metadata |
| `DELETE` | `/api/playlists/[id]` | delete playlist and related data |
| `POST` | `/api/playlists/[id]/refresh-m3u` | fetch M3U from stored URL and merge it |
| `POST` | `/api/playlists/[id]/refresh-epg` | fetch EPG from stored URL and cache it |

### Group and channel updates

| method | path | action |
|---|---|---|
| `PATCH` | `/api/groups/[id]` | update group display name or enabled state |
| `POST` | `/api/groups/sort` | persist group order for a playlist |
| `POST` | `/api/groups/merge` | merge one group into another |
| `PATCH` | `/api/channels/[id]` | update channel display name or enabled state |

### App settings

| method | path | action |
|---|---|---|
| `GET` | `/api/settings` | return global settings and recent log entries |
| `PATCH` | `/api/settings` | update settings and reload scheduler |

### Output and proxy routes

| method | path | action |
|---|---|---|
| `GET` | `/api/output/[id]/m3u` | serve filtered playlist by numeric id or slug |
| `GET` | `/api/output/[id]/xml` | serve filtered XMLTV by numeric id or slug |
| `GET` | `/api/stream/[channelId]` | transcode and stream a channel as MPEG-TS for the web player |
| `GET` | `/api/stream/segment` | proxy rewritten HLS segment requests |
| `GET` | `/api/proxy/logo` | image proxy for channel logos |

---

## M3U Ingest and Refresh Behavior

### Parsing

The parser reads `#EXTINF` entries and extracts:
- `tvg-id`
- `tvg-name`
- `tvg-logo`
- `group-title`
- display name from the text after the final comma
- stream URL from the following line

### Initial ingest

On first import:
1. The raw M3U is written to `raw/<playlist-id>.m3u`.
2. Unique groups are created in source order.
3. Channels are created and assigned to groups.
4. `m3u_last_fetched_at` is updated.

### Refresh merge logic

On M3U refresh from URL:
1. Fetch the current source playlist.
2. Rewrite the cached raw `.m3u` file.
3. Match groups by `original_name`.
4. Match channels using the first available key in this order:
   - `tvg_id`
   - `tvg_name`
   - `display_name`
5. Existing channels keep their identity and editable state while stream URL, logo, group, and sort order are updated.
6. Newly discovered channels are inserted enabled by default.
7. Channels no longer present in the source are not deleted; they are marked `enabled = false`.
8. User deltas are replayed so renames, enabled states, sorts, and merges survive refreshes.
9. A refresh log entry is written with added, updated, and removed counts.

Current implementation detail:
- Missing groups are not explicitly deleted or disabled during refresh. If a group loses all active channels, it may still remain in the database.

---

## EPG Ingest and Output Behavior

### Ingest

EPG import supports `.xml` and `.xml.gz`.

On ingest:
1. The source is fetched or read from upload.
2. Gzip content is decompressed if needed.
3. The XML is written to `raw/<playlist-id>.xml`.
4. `epg_last_fetched_at` is updated.

### Output filtering

The XML output route:
1. Resolves the playlist by numeric id or slug.
2. Loads enabled channels for that playlist.
3. Builds a set of enabled `tvg_id` values.
4. Reads the cached XML file from disk.
5. Filters `<channel>` and `<programme>` elements whose `id` or `channel` matches an enabled `tvg_id`.
6. Returns a synthetic filtered `<tv>` document.

Current implementation detail:
- Filtering is regex-based rather than using a full XML parser.
- Channels without a `tvg_id` cannot contribute to XML filtering.

---

## Output M3U Behavior

The generated M3U is built on request from database state.

Rules:
- only enabled groups are included
- groups are ordered by `sort_order`
- only enabled channels are included
- channels are ordered by `sort_order`
- `display_name` is used for channel and group labels
- `tvg-logo` and `tvg-id` are included when present

If `proxy_streams` is disabled:
- each channel points directly at its stored `stream_url`

If `proxy_streams` is enabled:
- each channel points at `/api/stream/<channel-id>`

The response uses:
- `Content-Type: application/x-mpegurl`
- `Content-Disposition: attachment; filename="<playlist-name>.m3u"`
## Stream Proxy Behavior

When stream proxying is enabled for a playlist:
1. The output M3U emits local stream proxy URLs.
2. For the built-in web player, the stream is transcoded to MPEG-TS on-the-fly via FFmpeg.
3. The transcoded data is piped directly to the HTTP response, providing ultra-low latency playback via `mpegts.js`.
4. Disconnecting the client (aborting the HTTP request) automatically terminates the underlying FFmpeg process.
5. Success and error events are written to `refresh_log` with type `stream`.

---

## Web Player Architecture

The built-in channel player uses **mpegts.js** for high-performance, low-latency live streaming.

1. **Protocol:** MPEG-TS over HTTP (Piped Stream).
2. **Latency:** Tuned for a small live buffer rather than segmented HLS output.
3. **Capabilities:** Supports all server-side transcoding profiles (720p, 1080p, Deinterlace, etc.).
4. **Browser Support:** Requires Media Source Extensions (MSE).

---

## Scheduler Behavior

The built-in player uses `/api/stream/[channelId]` for MPEG-TS playback profiles. Exported playlists only use this route when stream proxying is enabled.

---

## Scheduler Behavior

The scheduler is process-local and uses `setInterval`.

Global settings control whether M3U and EPG auto-refresh jobs run and at what intervals. When settings are changed, the scheduler is reloaded.

For each run:
- M3U refresh iterates every playlist with `auto_refresh = true` and a non-null `m3u_url`
- EPG refresh iterates every playlist with `auto_refresh = true` and a non-null `epg_url`
- each refresh writes success or error entries to `refresh_log`

Current implementation detail:
- Scheduling is in-memory per app process. In multi-process or multi-instance deployments, each process would run its own timers unless coordinated externally.

---

## Current Limitations

- Single-user app; no authentication or authorization
- No built-in video playback UI
- No full XML parser for EPG filtering
- Per-playlist settings do not currently support replacing the EPG via file upload after creation
- M3U refresh matching can fall back to `display_name`, which may be imperfect when sources change significantly
