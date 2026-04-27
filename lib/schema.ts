import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const playlists = sqliteTable('playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  m3uUrl: text('m3u_url'),
  m3uSourceType: text('m3u_source_type').notNull().default('url'),
  xtreamServerUrl: text('xtream_server_url'),
  xtreamUsername: text('xtream_username'),
  xtreamPassword: text('xtream_password'),
  xtreamOutput: text('xtream_output'),
  m3uLastFetchedAt: text('m3u_last_fetched_at'),
  epgUrl: text('epg_url'),
  epgSourceType: text('epg_source_type'),
  epgLastFetchedAt: text('epg_last_fetched_at'),
  slug: text('slug').notNull().default(''),
  autoRefresh: integer('auto_refresh', { mode: 'boolean' }).notNull().default(true),
  m3uRefreshInterval: integer('m3u_refresh_interval').notNull().default(24),
  epgRefreshInterval: integer('epg_refresh_interval').notNull().default(24),
  bufferSize: text('buffer_size').notNull().default('medium'),
  playbackProfile: text('playback_profile').notNull().default('direct'),
  transcodeBackend: text('transcode_backend').notNull().default('auto'),
  proxyStreams: integer('proxy_streams', { mode: 'boolean' }).notNull().default(false),
  proxyEpg: integer('proxy_epg', { mode: 'boolean' }).notNull().default(true),
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
  sourceKey: text('channel_source_key'),
  displayName: text('display_name').notNull(),
  streamUrl: text('stream_url').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const deltas = sqliteTable('deltas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
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
