'use client'

import { useEffect, useState, useCallback, use } from 'react'
import Link from 'next/link'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Group {
  id: number
  originalName: string
  displayName: string
  enabled: boolean
  sortOrder: number
}

interface Channel {
  id: number
  groupId: number
  tvgId: string | null
  tvgName: string
  tvgLogo: string | null
  displayName: string
  streamUrl: string
  enabled: boolean
}

interface PlaylistData {
  id: number
  name: string
  m3uUrl: string | null
  epgUrl: string | null
  epgLastFetchedAt: string | null
  groups: Group[]
  channels: Channel[]
}

const inputCls = 'w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500'

function SortableGroup({ group, selected, onSelect, onToggle, onRename, channelCount, enabledCount, mergeCount }: {
  group: Group
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onRename: (name: string) => void
  channelCount: number
  enabledCount: number
  mergeCount: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: group.id })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.displayName)

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer ${selected ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
      onClick={onSelect}>
      <span {...attributes} {...listeners} className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing text-xs select-none">⠿</span>
      <input type="checkbox" checked={group.enabled} onChange={onToggle}
        onClick={e => e.stopPropagation()}
        className="rounded border-gray-300 dark:border-gray-600 accent-blue-500 shrink-0" />
      {editing
        ? <input autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(draft) }}
            onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onRename(draft) } if (e.key === 'Escape') { setEditing(false); setDraft(group.displayName) } }}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0" />
        : <span onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}
            className="flex-1 text-sm truncate" title={group.originalName !== group.displayName ? `Source: ${group.originalName}` : 'Double-click to rename'}>
            {group.displayName}
            {group.originalName !== group.displayName && (
              <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">({group.originalName})</span>
            )}
          </span>
      }
      <div className="flex items-center gap-1 shrink-0">
        {mergeCount > 1 && (
          <span className="text-xs px-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" title="Merged in output">
            ×{mergeCount}
          </span>
        )}
        <span className="text-xs text-gray-400 dark:text-gray-500">{enabledCount}/{channelCount}</span>
      </div>
    </div>
  )
}

export default function PlaylistEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<PlaylistData | null>(null)
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([])
  const [groupSearch, setGroupSearch] = useState('')
  const [channelSearch, setChannelSearch] = useState('')
  const [refreshing, setRefreshing] = useState<'m3u' | 'epg' | null>(null)
  const [toast, setToast] = useState('')

  const sensors = useSensors(useSensor(PointerSensor))

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    fetch(`/api/playlists/${id}`).then(r => r.json()).then(d => {
      setData(d)
      if (d.groups.length > 0) setSelectedGroupIds([d.groups[0].id])
    })
  }, [id])

  const mergeMap = useCallback((groups: Group[]) => {
    const map = new Map<string, Group[]>()
    for (const g of groups) {
      if (!map.has(g.displayName)) map.set(g.displayName, [])
      map.get(g.displayName)!.push(g)
    }
    return map
  }, [])

  const selectGroup = useCallback((groupId: number, groups: Group[]) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    const merged = mergeMap(groups).get(group.displayName) ?? []
    setSelectedGroupIds(merged.map(g => g.id))
    setChannelSearch('')
  }, [mergeMap])

  const patchGroup = useCallback(async (groupId: number, updates: Partial<Group>) => {
    setData(d => d ? { ...d, groups: d.groups.map(g => g.id === groupId ? { ...g, ...updates } : g) } : d)
    await fetch(`/api/groups/${groupId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
  }, [])

  const patchChannel = useCallback(async (channelId: number, updates: Partial<Channel>) => {
    setData(d => d ? { ...d, channels: d.channels.map(c => c.id === channelId ? { ...c, ...updates } : c) } : d)
    await fetch(`/api/channels/${channelId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    if (!data) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = data.groups.findIndex(g => g.id === active.id)
    const newIndex = data.groups.findIndex(g => g.id === over.id)
    const reordered = arrayMove(data.groups, oldIndex, newIndex).map((g, i) => ({ ...g, sortOrder: i }))
    setData(d => d ? { ...d, groups: reordered } : d)
    await Promise.all(reordered.map(g => fetch(`/api/groups/${g.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: g.sortOrder }),
    })))
  }, [data])

  async function refreshM3U() {
    setRefreshing('m3u')
    const res = await fetch(`/api/playlists/${id}/refresh-m3u`, { method: 'POST' })
    const d = await res.json()
    if (res.ok) {
      showToast(`M3U refreshed: +${d.added} added, ${d.updated} updated, ${d.removed} removed`)
      const fresh = await fetch(`/api/playlists/${id}`).then(r => r.json())
      setData(fresh)
    } else {
      showToast(`Error: ${d.error}`)
    }
    setRefreshing(null)
  }

  async function refreshEPG() {
    setRefreshing('epg')
    const res = await fetch(`/api/playlists/${id}/refresh-epg`, { method: 'POST' })
    const d = await res.json()
    showToast(res.ok ? 'EPG refreshed' : `Error: ${d.error}`)
    setRefreshing(null)
  }

  async function bulkToggleGroup(enabled: boolean) {
    if (!data || selectedGroupIds.length === 0) return
    const chs = data.channels.filter(c => selectedGroupIds.includes(c.groupId))
    setData(d => d ? { ...d, channels: d.channels.map(c => selectedGroupIds.includes(c.groupId) ? { ...c, enabled } : c) } : d)
    await Promise.all(chs.map(c => fetch(`/api/channels/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    })))
  }

  async function bulkToggleAllGroups(enabled: boolean) {
    if (!data) return
    setData(d => d ? { ...d, groups: d.groups.map(g => ({ ...g, enabled })) } : d)
    await Promise.all(data.groups.map(g => fetch(`/api/groups/${g.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    })))
  }

  if (!data) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  const mm = mergeMap(data.groups)
  const filteredGroups = data.groups.filter(g => g.displayName.toLowerCase().includes(groupSearch.toLowerCase()))
  const selectedGroups = data.groups.filter(g => selectedGroupIds.includes(g.id))
  const groupChannels = data.channels.filter(c => selectedGroupIds.includes(c.groupId))
  const filteredChannels = groupChannels.filter(c => c.displayName.toLowerCase().includes(channelSearch.toLowerCase()))
  const totalEnabled = data.channels.filter(c => c.enabled).length

  const selectedDisplayName = selectedGroups[0]?.displayName ?? null
  const isMerged = selectedDisplayName !== null && (mm.get(selectedDisplayName)?.length ?? 0) > 1

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm">← Playlists</Link>
          <h1 className="text-xl font-semibold">{data.name}</h1>
          <span className="text-sm text-gray-400 dark:text-gray-500">{totalEnabled} / {data.channels.length} channels</span>
        </div>
        <div className="flex gap-2">
          {data.m3uUrl && (
            <button onClick={refreshM3U} disabled={!!refreshing}
              className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors">
              {refreshing === 'm3u' ? 'Refreshing...' : 'Refresh M3U'}
            </button>
          )}
          {data.epgUrl && (
            <button onClick={refreshEPG} disabled={!!refreshing}
              className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors">
              {refreshing === 'epg' ? 'Refreshing...' : 'Refresh EPG'}
            </button>
          )}
          <Link href={`/playlists/${id}/settings`}
            className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            Settings
          </Link>
        </div>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Left: groups */}
        <div className="w-72 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden shrink-0">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
            <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)}
              placeholder="Search groups..." className={inputCls} />
            <div className="flex gap-2 text-xs">
              <button onClick={() => bulkToggleAllGroups(true)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">Enable all</button>
              <span className="text-gray-300 dark:text-gray-700">·</span>
              <button onClick={() => bulkToggleAllGroups(false)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">Disable all</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredGroups.map(g => g.id)} strategy={verticalListSortingStrategy}>
                {filteredGroups.map(g => {
                  const gChannels = data.channels.filter(c => c.groupId === g.id)
                  const gEnabled = gChannels.filter(c => c.enabled).length
                  const mergeCount = mm.get(g.displayName)?.length ?? 1
                  return (
                    <SortableGroup key={g.id} group={g}
                      selected={selectedGroupIds.includes(g.id)}
                      onSelect={() => selectGroup(g.id, data.groups)}
                      onToggle={() => patchGroup(g.id, { enabled: !g.enabled })}
                      onRename={name => patchGroup(g.id, { displayName: name })}
                      channelCount={gChannels.length}
                      enabledCount={gEnabled}
                      mergeCount={mergeCount}
                    />
                  )
                })}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Right: channels */}
        <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                  {selectedDisplayName ?? 'Select a group'}
                </span>
                {isMerged && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 shrink-0">
                    {mm.get(selectedDisplayName!)!.length} sources merged
                  </span>
                )}
              </div>
              {selectedGroupIds.length > 0 && (
                <div className="flex gap-2 text-xs shrink-0">
                  <button onClick={() => bulkToggleGroup(true)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">Enable all</button>
                  <span className="text-gray-300 dark:text-gray-700">·</span>
                  <button onClick={() => bulkToggleGroup(false)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">Disable all</button>
                </div>
              )}
            </div>
            <input value={channelSearch} onChange={e => setChannelSearch(e.target.value)}
              placeholder="Search channels..." className={inputCls} />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredChannels.map(ch => (
              <ChannelRow key={ch.id} channel={ch}
                onToggle={() => patchChannel(ch.id, { enabled: !ch.enabled })}
                onRename={name => patchChannel(ch.id, { displayName: name })}
              />
            ))}
            {filteredChannels.length === 0 && (
              <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-8">No channels</p>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-sm shadow-lg text-gray-900 dark:text-gray-100">
          {toast}
        </div>
      )}
    </div>
  )
}

function ChannelRow({ channel, onToggle, onRename }: {
  channel: Channel
  onToggle: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(channel.displayName)

  return (
    <div className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 group">
      <input type="checkbox" checked={channel.enabled} onChange={onToggle}
        className="rounded border-gray-300 dark:border-gray-600 accent-blue-500 shrink-0" />
      {channel.tvgLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/proxy/logo?url=${encodeURIComponent(channel.tvgLogo)}`} alt="" className="w-6 h-6 object-contain rounded shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
      )}
      {editing
        ? <input autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(draft) }}
            onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onRename(draft) } if (e.key === 'Escape') { setEditing(false); setDraft(channel.displayName) } }}
            className="flex-1 bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0" />
        : <span onDoubleClick={() => setEditing(true)}
            className="flex-1 text-sm truncate" title="Double-click to rename">
            {channel.displayName}
          </span>
      }
    </div>
  )
}
