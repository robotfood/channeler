import { sqlite } from './db'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playlist'
}

export function runMigrations() {
  try { sqlite.exec(`ALTER TABLE playlists ADD COLUMN proxy_streams INTEGER NOT NULL DEFAULT 0`) } catch {}
  try { sqlite.exec(`ALTER TABLE playlists ADD COLUMN slug TEXT NOT NULL DEFAULT ''`) } catch {}

  // Populate slugs for existing playlists that don't have one
  const rows = sqlite.prepare(`SELECT id, name FROM playlists WHERE slug = '' OR slug IS NULL`).all() as { id: number; name: string }[]
  for (const row of rows) {
    sqlite.prepare(`UPDATE playlists SET slug = ? WHERE id = ?`).run(slugify(row.name), row.id)
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      m3u_url TEXT,
      m3u_source_type TEXT NOT NULL DEFAULT 'url',
      m3u_last_fetched_at TEXT,
      epg_url TEXT,
      epg_source_type TEXT,
      epg_last_fetched_at TEXT,
      slug TEXT NOT NULL DEFAULT '',
      auto_refresh INTEGER NOT NULL DEFAULT 1,
      proxy_streams INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      tvg_id TEXT,
      tvg_name TEXT,
      tvg_logo TEXT,
      display_name TEXT NOT NULL,
      stream_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('m3u_auto_refresh_enabled', 'false'),
      ('m3u_refresh_interval_seconds', '86400'),
      ('epg_auto_refresh_enabled', 'false'),
      ('epg_refresh_interval_seconds', '86400');
  `)
}
