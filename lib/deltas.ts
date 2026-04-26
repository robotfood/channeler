import { db } from './db'
import { deltas, groups, channels } from './schema'
import { eq, asc } from 'drizzle-orm'

export type Delta =
  | { type: 'group_rename'; originalName: string; displayName: string }
  | { type: 'group_enabled'; originalName: string; enabled: boolean }
  | { type: 'group_sort'; orderedNames: string[] }
  | { type: 'group_merge'; targetName: string; sourceName: string }
  | { type: 'channel_rename'; channelKey: string; displayName: string }
  | { type: 'channel_enabled'; channelKey: string; enabled: boolean }
  | { type: 'channel_deleted'; channelKey: string; isDeleted: boolean }

export function legacyChannelKey(c: { tvgId: string | null; tvgName: string | null; displayName: string }): string {
  return c.tvgId || c.tvgName || c.displayName
}

export function channelKey(c: { sourceKey?: string | null; tvgId: string | null; tvgName: string | null; displayName: string }): string {
  return c.sourceKey || legacyChannelKey(c)
}

export async function writeDelta(playlistId: number, delta: Delta) {
  await db.insert(deltas).values({ playlistId, type: delta.type, payload: JSON.stringify(delta) })
}

export async function applyDeltas(playlistId: number) {
  const rows = await db.select().from(deltas)
    .where(eq(deltas.playlistId, playlistId))
    .orderBy(asc(deltas.id))

  // Collapse to latest per key
  const groupRenames = new Map<string, string>()
  const groupEnabled = new Map<string, boolean>()
  let groupSort: string[] | null = null
  const merges: Array<{ targetName: string; sourceName: string }> = []
  const channelRenames = new Map<string, string>()
  const channelEnabled = new Map<string, boolean>()
  const channelDeleted = new Map<string, boolean>()

  for (const row of rows) {
    const d = JSON.parse(row.payload) as Delta
    switch (d.type) {
      case 'group_rename':   groupRenames.set(d.originalName, d.displayName); break
      case 'group_enabled':  groupEnabled.set(d.originalName, d.enabled); break
      case 'group_sort':     groupSort = d.orderedNames; break
      case 'group_merge':    merges.push({ targetName: d.targetName, sourceName: d.sourceName }); break
      case 'channel_rename': channelRenames.set(d.channelKey, d.displayName); break
      case 'channel_enabled':channelEnabled.set(d.channelKey, d.enabled); break
      case 'channel_deleted':channelDeleted.set(d.channelKey, d.isDeleted); break
    }
  }

  const allGroups = await db.select().from(groups).where(eq(groups.playlistId, playlistId))
  const allChannels = await db.select().from(channels).where(eq(channels.playlistId, playlistId))

  const groupByName = new Map(allGroups.map(g => [g.originalName, g]))
  const channelByKey = new Map(allChannels.map(c => [channelKey(c), c]))
  for (const channel of allChannels) {
    const legacyKey = legacyChannelKey(channel)
    if (!channelByKey.has(legacyKey)) channelByKey.set(legacyKey, channel)
  }

  // Merges first — they affect which groups exist
  for (const { targetName, sourceName } of merges) {
    const target = groupByName.get(targetName)
    const source = groupByName.get(sourceName)
    if (target && source && target.id !== source.id) {
      await db.update(channels).set({ groupId: target.id }).where(eq(channels.groupId, source.id))
      await db.delete(groups).where(eq(groups.id, source.id))
      groupByName.delete(sourceName)
    }
  }

  for (const [originalName, displayName] of groupRenames) {
    const g = groupByName.get(originalName)
    if (g) await db.update(groups).set({ displayName }).where(eq(groups.id, g.id))
  }

  for (const [originalName, enabled] of groupEnabled) {
    const g = groupByName.get(originalName)
    if (g) await db.update(groups).set({ enabled }).where(eq(groups.id, g.id))
  }

  if (groupSort) {
    for (let i = 0; i < groupSort.length; i++) {
      const g = groupByName.get(groupSort[i])
      if (g) await db.update(groups).set({ sortOrder: i }).where(eq(groups.id, g.id))
    }
  }

  for (const [key, displayName] of channelRenames) {
    const c = channelByKey.get(key)
    if (c) await db.update(channels).set({ displayName }).where(eq(channels.id, c.id))
  }

  for (const [key, enabled] of channelEnabled) {
    const c = channelByKey.get(key)
    if (c) await db.update(channels).set({ enabled }).where(eq(channels.id, c.id))
  }

  for (const [key, isDeleted] of channelDeleted) {
    const c = channelByKey.get(key)
    if (c) await db.update(channels).set({ isDeleted }).where(eq(channels.id, c.id))
  }
}
