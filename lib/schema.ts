import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const playlists = sqliteTable('playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  m3uUrl: text('m3u_url'),
  m3uSourceType: text('m3u_source_type').notNull().default('url'),
  m3uLastFetchedAt: text('m3u_last_fetched_at'),
  epgUrl: text('epg_url'),
  epgSourceType: text('epg_source_type'),
  epgLastFetchedAt: text('epg_last_fetched_at'),
  autoRefresh: integer('auto_refresh', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  originalName: text('original_name').notNull(),
  displayName: text('display_name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  tvgId: text('tvg_id'),
  tvgName: text('tvg_name'),
  tvgLogo: text('tvg_logo'),
  displayName: text('display_name').notNull(),
  streamUrl: text('stream_url').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const refreshLog = sqliteTable('refresh_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').references(() => playlists.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'm3u' | 'epg'
  triggeredBy: text('triggered_by').notNull(), // 'auto' | 'manual'
  status: text('status').notNull(), // 'success' | 'error'
  detail: text('detail'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})
