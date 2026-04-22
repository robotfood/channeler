import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import * as schema from './schema'
import path from 'path'
import fs from 'fs'

const dataPath = process.env.DATA_PATH ?? path.join(process.cwd(), 'data')
fs.mkdirSync(dataPath, { recursive: true })
fs.mkdirSync(path.join(dataPath, 'raw'), { recursive: true })

const dbPath = path.join(dataPath, 'db.sqlite')
const sqlite = new DatabaseSync(dbPath)
sqlite.exec('PRAGMA journal_mode = WAL')
sqlite.exec('PRAGMA foreign_keys = ON')

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
