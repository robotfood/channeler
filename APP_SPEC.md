# M3U Playlist Manager — App Spec

## Overview

A self-hosted Next.js web app that ingests M3U IPTV playlists and their associated EPG sources, lets you filter and rename groups and channels, and serves the filtered results as live M3U and EPG proxy URLs that any IPTV player on the local network can consume. Multiple independent playlists are supported, each with its own editor, output M3U URL, and optional EPG URL.

---

## Stack

- **Framework:** Next.js (App Router)
- **Database:** SQLite via `better-sqlite3`
- **ORM/query layer:** `drizzle-orm`
- **Deployment:** Docker container; SQLite file mounted from host via volume

---

## Docker / Deployment

```
docker run -p 3000:3000 \
  -v /your/host/path/data:/app/data \
  m3u-manager
```

- SQLite file lives at `/app/data/db.sqlite` inside the container
- The container exposes port 3000
- Output M3U URL: `http://<host-ip>:3000/api/output/<playlist-id>.m3u`
- Output EPG URL: `http://<host-ip>:3000/api/output/<playlist-id>.xml`

---

## Core Concepts

| Term | Meaning |
|---|---|
| **Playlist** | One M3U source + optional EPG source, managed as a unit |
| **Group** | The `group-title` field in the M3U (e.g. "US", "Sports", "Canada") |
| **Channel** | A single `#EXTINF` + stream URL pair |
| **EPG source** | An XMLTV-format file (`.xml` or `.xml.gz`), one per playlist |
| **Output M3U** | The filtered/renamed M3U served at the proxy URL |
| **Output EPG** | The filtered XMLTV served at the proxy URL, containing only enabled channels |

---

## Data Model (SQLite)

### `playlists`
| column | type | notes |
|---|---|---|
| id | integer PK | |
| name | text | user-facing label |
| m3u_url | text | nullable — URL to refresh M3U from |
| m3u_source_type | text | `"url"` or `"upload"` |
| m3u_last_fetched_at | datetime | |
| epg_url | text | nullable — URL to refresh EPG from |
| epg_source_type | text | `"url"`, `"upload"`, or null |
| epg_last_fetched_at | datetime | |
| created_at | datetime | |

> Raw M3U and EPG content is stored on disk at `/app/data/raw/<id>.m3u` and `/app/data/raw/<id>.xml` to avoid bloating the DB with large text blobs.

### `groups`
| column | type | notes |
|---|---|---|
| id | integer PK | |
| playlist_id | integer FK | |
| original_name | text | as it appears in the M3U |
| display_name | text | user-set override (default = original_name) |
| enabled | boolean | false = excluded from output |
| sort_order | integer | user-controlled ordering |

### `channels`
| column | type | notes |
|---|---|---|
| id | integer PK | |
| group_id | integer FK | |
| playlist_id | integer FK | |
| tvg_id | text | links to EPG `<channel id="">` |
| tvg_name | text | |
| tvg_logo | text | |
| display_name | text | user-set override |
| stream_url | text | |
| enabled | boolean | false = excluded from output |

---

## Pages & UI

### `/` — Dashboard
- List of all playlists as cards showing: name, channel count (enabled / total), group count, last M3U refresh time, last EPG refresh time
- "Add Playlist" button
- Per-card actions: Edit, Settings, Delete
- Per-card: "Copy M3U URL" and "Copy EPG URL" buttons (EPG button grayed out if no EPG source configured)

### `/playlists/new` — Add Playlist

**Step 1 — M3U source**
- Two tabs: **URL** and **Upload**
- URL tab: text field for M3U URL, text field for playlist name (auto-suggested from URL)
- Upload tab: drag-and-drop or file picker for `.m3u` / `.m3u8`

**Step 2 — EPG source (optional, skippable)**
- Same two-tab pattern: URL or Upload
- URL tab: text field for XMLTV URL (`.xml` or `.xml.gz`)
- Upload tab: file picker for `.xml` / `.xml.gz`
- "Skip for now" option — EPG can be added later in Settings

On submit: fetch/parse M3U (and EPG if provided), seed DB, redirect to the playlist editor.

### `/playlists/[id]` — Playlist Editor

Two-panel layout:

**Left panel — Group list**
- All groups for this playlist, ordered by `sort_order`
- Each row: toggle (enabled/disabled), group name (click to rename inline), enabled/total channel count badge, drag handle for reordering
- Bulk actions: "Enable all", "Disable all"
- Search/filter field to find groups by name

**Right panel — Channel list**
- Shows channels for the currently selected group
- Each row: channel logo (small thumbnail), channel name (click to rename inline), toggle (enabled/disabled)
- Search/filter field within the group
- Selecting a different group in the left panel updates this panel

**Top bar**
- Playlist name
- "Refresh M3U" button — re-fetches and merges M3U
- "Refresh EPG" button — re-fetches EPG (grayed out if no EPG configured)
- "Copy M3U URL" and "Copy EPG URL" buttons
- Stats: X of Y channels enabled across Z groups

### `/playlists/[id]/settings` — Playlist Settings
- Rename the playlist
- Change or remove M3U source URL
- Add, change, or remove EPG source (URL or upload)
- "Refresh now" buttons for M3U and EPG individually
- Delete playlist (with confirmation — warns that all edits will be lost)

---

## API Routes

### Playlist management
| method | path | action |
|---|---|---|
| `GET` | `/api/playlists` | List all playlists (metadata) |
| `POST` | `/api/playlists` | Create playlist (body: m3u URL or file, optional EPG URL or file, name) |
| `GET` | `/api/playlists/[id]` | Playlist + all groups + channels |
| `PATCH` | `/api/playlists/[id]` | Update name, m3u_url, epg_url |
| `DELETE` | `/api/playlists/[id]` | Delete playlist and all data |
| `POST` | `/api/playlists/[id]/refresh-m3u` | Re-fetch and merge M3U |
| `POST` | `/api/playlists/[id]/refresh-epg` | Re-fetch and cache EPG |

### Group & channel edits
| method | path | action |
|---|---|---|
| `PATCH` | `/api/groups/[id]` | Update `display_name`, `enabled`, `sort_order` |
| `PATCH` | `/api/channels/[id]` | Update `display_name`, `enabled` |

### Output (proxy) endpoints
| method | path | action |
|---|---|---|
| `GET` | `/api/output/[id].m3u` | Filtered M3U for IPTV player |
| `GET` | `/api/output/[id].xml` | Filtered EPG for IPTV player |

---

## Output M3U Format

Generated on-the-fly from DB state. Only enabled groups (in `sort_order`) and enabled channels within them are included. Display name overrides are applied.

```
#EXTM3U
#EXTINF:-1 tvg-id="cnn.us" tvg-name="cnn.us" tvg-logo="https://..." group-title="News",CNN US
https://starlite.best/api/stream/.../cnn.us.m3u8
```

- `Content-Type: application/x-mpegurl`
- Stream URLs pass through as-is (IPTV player hits the source directly — no video proxying)

---

## Output EPG Format

The EPG proxy filters the cached XMLTV file down to only the `<channel>` and `<programme>` elements whose `id`/`channel` attribute matches a `tvg-id` of an enabled channel in this playlist.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="cnn.us">...</channel>
  <programme channel="cnn.us" start="..." stop="...">...</programme>
  ...
</tv>
```

- `Content-Type: application/xml`
- Served from the cached file on disk — does not re-fetch on every request
- `.xml.gz` sources are decompressed on ingest and stored as plain XML

---

## M3U Parsing Rules

```
#EXTINF:-1 tvg-id="..." tvg-name="..." tvg-type="live" group-title="US" tvg-logo="...",Display Name
https://stream.url/path.m3u8
```

Parser extracts:
- `tvg-id`, `tvg-name`, `tvg-logo`, `group-title` from `#EXTINF` attributes (regex over the attribute string)
- Display name from the text after the last `,` on the `#EXTINF` line
- Stream URL from the immediately following line

Groups are auto-created from unique `group-title` values in the file.

---

## Refresh / Merge Logic (M3U)

1. Re-fetch raw M3U, write to `/app/data/raw/<id>.m3u`
2. For each group in the new data: match by `original_name` — keep existing `display_name` / `enabled` / `sort_order`; insert new groups as enabled with default sort at end
3. For each channel: match by `tvg-id` (fall back to `tvg-name` + `stream_url` hash); preserve `display_name` and `enabled`; update `stream_url` if changed
4. Channels/groups no longer present in source: mark `enabled = false`, keep in DB (user may have renamed them)

---

## EPG Refresh Logic

1. Re-fetch from `epg_url` (handle `.xml.gz` decompression)
2. Write decompressed XML to `/app/data/raw/<id>.xml`
3. Update `epg_last_fetched_at`
4. No per-channel DB records needed — EPG is filtered at serve time by streaming the XML and matching `tvg-id` values

---

## Dockerfile (outline)

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
ENV DATABASE_PATH=/app/data/db.sqlite
ENV RAW_DATA_PATH=/app/data/raw
CMD ["node", "server.js"]
```

Volume mount: `-v /host/data:/app/data`

---

---

## Global Settings (`/settings`)

A single settings page (not per-playlist) for app-wide configuration.

### Auto-Refresh

Configure a background job that periodically re-fetches M3U and/or EPG sources for all playlists that have a URL source.

| setting | type | default | notes |
|---|---|---|---|
| M3U auto-refresh enabled | boolean | false | |
| M3U refresh interval | select | 24h | options: 1h, 6h, 12h, 24h, 7d |
| EPG auto-refresh enabled | boolean | false | |
| EPG refresh interval | select | 24h | options: 1h, 6h, 12h, 24h, 7d |

On each refresh cycle:
1. For every playlist with a URL-based M3U source: run the M3U refresh + merge logic
2. For every playlist with a URL-based EPG source: re-download and cache the EPG file
3. Log the result (timestamp, playlist name, success/error, channel delta: added/removed counts)

**Refresh log** — shown on the Settings page as a table: timestamp, playlist, type (M3U/EPG), status (success/error), details (e.g. "+3 channels, -1 group" or error message). Last 50 entries kept.

### Per-Playlist Refresh Override

Each playlist can opt out of global auto-refresh. Toggle visible in `/playlists/[id]/settings` — "Include in auto-refresh" (default: on).

### Data Model additions

**`settings`** (key-value table)
| column | type |
|---|---|
| key | text PK |
| value | text |

Keys: `m3u_auto_refresh_enabled`, `m3u_refresh_interval_seconds`, `epg_auto_refresh_enabled`, `epg_refresh_interval_seconds`

**`refresh_log`**
| column | type | notes |
|---|---|---|
| id | integer PK | |
| playlist_id | integer FK | |
| type | text | `"m3u"` or `"epg"` |
| triggered_by | text | `"auto"` or `"manual"` |
| status | text | `"success"` or `"error"` |
| detail | text | channel delta or error message |
| created_at | datetime | |

### Background Job Implementation

Use a lightweight in-process scheduler (e.g. `node-cron` or `setInterval` in a Next.js custom server) that reads the interval settings from the DB at startup and on settings change. Runs entirely within the container — no external job runner needed.

---

## Out of Scope (v1)

- User authentication (single-user, trusted local network)
- Video playback within the web app
- Merging multiple source playlists into one output
- Stream health checking / dead link detection
