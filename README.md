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
- Refresh log showing history of all fetches

## Quick start (Docker)

```bash
docker build -t channeler .

docker run -d \
  -p 3000:3000 \
  -v /your/host/path/data:/app/data \
  --name channeler \
  channeler
```

Open [http://localhost:3000](http://localhost:3000).

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
