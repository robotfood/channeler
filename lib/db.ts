import type { SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import * as schema from './schema'
import path from 'path'
import { dataPath, ensureDataDirectories } from './data-path'

const sqliteModule = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
if (!sqliteModule) throw new Error('node:sqlite is not available in this Node.js runtime')
const { DatabaseSync } = sqliteModule

ensureDataDirectories()

const dbPath = path.join(dataPath, 'db.sqlite')
const sqlite = new DatabaseSync(dbPath, { timeout: 10000 })
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA foreign_keys = ON')

function ensureRuntimeColumns() {
  try { sqlite.exec(`ALTER TABLE playlists ADD COLUMN buffer_size TEXT NOT NULL DEFAULT 'medium'`) } catch {}
  try { sqlite.exec(`ALTER TABLE playlists ADD COLUMN playback_profile TEXT NOT NULL DEFAULT 'direct'`) } catch {}
  try { sqlite.exec(`ALTER TABLE playlists ADD COLUMN transcode_backend TEXT NOT NULL DEFAULT 'auto'`) } catch {}
  try { sqlite.exec(`ALTER TABLE playlists ADD COLUMN audio_profile TEXT NOT NULL DEFAULT 'standard'`) } catch {}
}

ensureRuntimeColumns()

export const db = drizzle(
  async (sql, params, method) => {
    const stmt = sqlite.prepare(sql)
    const p = params as SQLInputValue[]
    if (method === 'run') {
      stmt.run(...p)
      return { rows: [] }
    }
    const rows = method === 'get'
      ? [stmt.get(...p)].filter(Boolean)
      : stmt.all(...p)
    return { rows: (rows as Record<string, unknown>[]).map(r => Object.values(r)) }
  },
  { schema }
)

export { sqlite, dataPath }
