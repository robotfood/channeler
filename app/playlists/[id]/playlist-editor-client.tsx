'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import Link from 'next/link'
import type { PlaylistData } from '@/lib/app-data'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import ChannelPlayer from '@/components/channel-player'
import { channelPlaybackUrl } from '@/lib/stream-url'

type Group = PlaylistData['groups'][number]
type Channel = PlaylistData['channels'][number]

const inputCls = 'w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500'

function SortableGroup({ group, selected, merging, mergeSelected, onSelect, onToggle, onRename, channelCount, enabledCount }: {
  group: Group
  selected: boolean
  merging: boolean
  mergeSelected: boolean
  onSelect: () => void
  onToggle: () => void
  onRename: (name: string) => void
  channelCount: number
  enabledCount: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: group.id })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.displayName)

  const style = { transform: CSS.Transform.toString(transform), transition }

  let rowCls = 'flex items-center gap-2 px-3 py-2 rounded cursor-pointer '
  if (merging) {
    rowCls += mergeSelected
      ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-600 '
      : 'hover:bg-gray-100 dark:hover:bg-gray-800 '
  } else {
    rowCls += selected ? 'bg-gray-200 dark:bg-gray-700 ' : 'hover:bg-gray-100 dark:hover:bg-gray-800 '
  }

  return (
    <div ref={setNodeRef} style={style} className={rowCls} onClick={onSelect}>
      {!merging && (
        <span {...attributes} {...listeners} className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing text-xs select-none">⠿</span>
      )}
      {merging
        ? <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${mergeSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
            {mergeSelected && <span className="text-white text-xs">✓</span>}
          </span>
        : <input type="checkbox" checked={group.enabled} onChange={onToggle}
            onClick={e => e.stopPropagation()}
            className="rounded border-gray-300 dark:border-gray-600 accent-blue-500 shrink-0" />
      }
      {editing
        ? <input autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(draft) }}
            onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onRename(draft) } if (e.key === 'Escape') { setEditing(false); setDraft(group.displayName) } }}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0" />
        : <span onDoubleClick={e => { if (!merging) { e.stopPropagation(); setEditing(true) } }}
            className="flex-1 text-sm truncate" title="Double-click to rename">
            {group.displayName}
          </span>
      }
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{enabledCount}/{channelCount}</span>
    </div>
  )
}

export default function PlaylistEditorClient({ initialData, playlistId }: {
  initialData: PlaylistData
  playlistId: string
}) {
  const [data, setData] = useState<PlaylistData>(initialData)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(initialData.groups[0]?.id ?? null)
  const [groupSearch, setGroupSearch] = useState('')
  const [channelSearch, setChannelSearch] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null)
  const [groupEpg, setGroupEpg] = useState<Record<number, { title: string }>>({})
  const [refreshing, setRefreshing] = useState<'m3u' | 'epg' | null>(null)
  const [toast, setToast] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeIds, setMergeIds] = useState<number[]>([])

  const sensors = useSensors(useSensor(PointerSensor))

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    if (!selectedGroupId) return
    fetch(`/api/groups/${selectedGroupId}/epg`)
      .then(res => res.json())
      .then(setGroupEpg)
      .catch(() => {})
  }, [selectedGroupId])

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
    await fetch('/api/groups/sort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: data.id, orderedIds: reordered.map(g => g.id) }),
    })
  }, [data])

  function handleGroupClick(groupId: number) {
    if (!merging) {
      setSelectedGroupId(groupId)
      setChannelSearch('')
      return
    }
    setMergeIds(prev => {
      if (prev.includes(groupId)) return prev.filter(id => id !== groupId)
      if (prev.length >= 2) return prev
      return [...prev, groupId]
    })
  }

  async function confirmMerge() {
    if (!data || mergeIds.length !== 2) return
    const [targetId, sourceId] = mergeIds
    const target = data.groups.find(g => g.id === targetId)!
    const source = data.groups.find(g => g.id === sourceId)!

    await fetch('/api/groups/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, sourceId }),
    })

    // Update local state: move source channels to target, remove source group
    setData(d => d ? {
      ...d,
      groups: d.groups.filter(g => g.id !== sourceId),
      channels: d.channels.map(c => c.groupId === sourceId ? { ...c, groupId: targetId } : c),
    } : d)

    setMerging(false)
    setMergeIds([])
    setSelectedGroupId(targetId)
    showToast(`Merged "${source.displayName}" into "${target.displayName}"`)
  }

  function cancelMerge() {
    setMerging(false)
    setMergeIds([])
  }

  async function refreshM3U() {
    setRefreshing('m3u')
    const res = await fetch(`/api/playlists/${playlistId}/refresh-m3u`, { method: 'POST' })
    const d = await res.json()
    if (res.ok) {
      showToast(`M3U refreshed: +${d.added} added, ${d.updated} updated, ${d.removed} removed`)
      const fresh = await fetch(`/api/playlists/${playlistId}`).then(r => r.json())
      setData(fresh)
    } else {
      showToast(`Error: ${d.error}`)
    }
    setRefreshing(null)
  }

  async function refreshEPG() {
    setRefreshing('epg')
    const res = await fetch(`/api/playlists/${playlistId}/refresh-epg`, { method: 'POST' })
    const d = await res.json()
    showToast(res.ok ? 'EPG refreshed' : `Error: ${d.error}`)
    setRefreshing(null)
  }

  async function bulkToggleChannels(chs: Channel[], enabled: boolean) {
    if (!data || chs.length === 0) return
    const ids = new Set(chs.map(c => c.id))
    setData(d => d ? { ...d, channels: d.channels.map(c => ids.has(c.id) ? { ...c, enabled } : c) } : d)
    await Promise.all(chs.map(c => fetch(`/api/channels/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    })))
  }

  async function bulkToggleGroups(targetGroups: Group[], enabled: boolean) {
    if (!data || targetGroups.length === 0) return
    const ids = new Set(targetGroups.map(g => g.id))
    setData(d => d ? { ...d, groups: d.groups.map(g => ids.has(g.id) ? { ...g, enabled } : g) } : d)
    await Promise.all(targetGroups.map(g => fetch(`/api/groups/${g.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    })))
  }

  const channelIndex = useMemo(() => {
    const byGroup = new Map<number, Channel[]>()
    const statsByGroup = new Map<number, { total: number; enabled: number; deleted: number }>()
    let totalEnabled = 0

    for (const channel of data?.channels ?? []) {
      const groupChannels = byGroup.get(channel.groupId)
      if (groupChannels) {
        groupChannels.push(channel)
      } else {
        byGroup.set(channel.groupId, [channel])
      }

      const stats = statsByGroup.get(channel.groupId) ?? { total: 0, enabled: 0, deleted: 0 }
      if (channel.isDeleted) {
        stats.deleted++
      } else {
        stats.total++
        if (channel.enabled) {
          stats.enabled++
          totalEnabled++
        }
      }
      statsByGroup.set(channel.groupId, stats)
    }

    return { byGroup, statsByGroup, totalEnabled }
  }, [data.channels])

  const groupsById = useMemo(() => new Map(data.groups.map(g => [g.id, g])), [data.groups])
  const groupSearchTerm = groupSearch.toLowerCase()
  const channelSearchTerm = channelSearch.toLowerCase()

  const filteredGroups = useMemo(
    () => data.groups.filter(g => g.displayName.toLowerCase().includes(groupSearchTerm)),
    [data.groups, groupSearchTerm]
  )
  const selectedGroup = selectedGroupId ? groupsById.get(selectedGroupId) : undefined
  const filteredChannels = useMemo(
    () => {
      const groupChannels = selectedGroupId ? (channelIndex.byGroup.get(selectedGroupId) ?? []) : []
      return groupChannels.filter(c =>
        c.displayName.toLowerCase().includes(channelSearchTerm) &&
        (showTrash ? c.isDeleted : !c.isDeleted)
      )
    },
    [channelIndex.byGroup, selectedGroupId, channelSearchTerm, showTrash]
  )

  const mergeTarget = groupsById.get(mergeIds[0])
  const mergeSource = groupsById.get(mergeIds[1])

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] w-full max-w-7xl flex-col">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm">← Playlists</Link>
          <h1 className="text-xl font-semibold">{data.name}</h1>
          <span className="text-sm text-gray-400 dark:text-gray-500">{channelIndex.totalEnabled} / {data.channels.length} channels</span>
        </div>
        <div className="flex gap-2">
          {(data.m3uUrl || data.m3uSourceType === 'xtream') && (
            <button onClick={refreshM3U} disabled={!!refreshing}
              className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors">
              {refreshing === 'm3u' ? 'Refreshing...' : 'Refresh M3U'}
            </button>
          )}
          {(data.epgUrl || data.epgSourceType === 'xtream') && (
            <button onClick={refreshEPG} disabled={!!refreshing}
              className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors">
              {refreshing === 'epg' ? 'Refreshing...' : 'Refresh EPG'}
            </button>
          )}
          <Link href={`/playlists/${playlistId}/settings`}
            className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            Settings
          </Link>
        </div>
      </div>

      <div className={`grid min-h-0 flex-1 gap-4 overflow-hidden transition-all duration-300 ${playingChannel ? 'grid-cols-[16rem_1fr_24rem]' : 'grid-cols-[18rem_minmax(0,1fr)]'}`}>
        {/* Left: groups */}
        <div className="min-h-0 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
            {merging ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {mergeIds.length === 0 && 'Select the group to merge into'}
                  {mergeIds.length === 1 && `Into: "${mergeTarget?.displayName}" — now select the group to absorb`}
                  {mergeIds.length === 2 && `Merge "${mergeSource?.displayName}" into "${mergeTarget?.displayName}"`}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmMerge}
                    disabled={mergeIds.length !== 2}
                    className="flex-1 text-xs px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium transition-colors">
                    Merge
                  </button>
                  <button onClick={cancelMerge}
                    className="flex-1 text-xs px-2 py-1.5 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)}
                  placeholder="Search groups..." className={inputCls} />
                <div className="flex gap-2 text-xs">
                  <button onClick={() => bulkToggleGroups(filteredGroups, true)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">Enable all</button>
                  <span className="text-gray-300 dark:text-gray-700">·</span>
                  <button onClick={() => bulkToggleGroups(filteredGroups, false)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">Disable all</button>
                  <span className="text-gray-300 dark:text-gray-700">·</span>
                  <button onClick={() => setMerging(true)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">Merge</button>
                </div>
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredGroups.map(g => g.id)} strategy={verticalListSortingStrategy}>
                {filteredGroups.map(g => {
                  const stats = channelIndex.statsByGroup.get(g.id) ?? { total: 0, enabled: 0, deleted: 0 }
                  return (
                    <SortableGroup key={g.id} group={g}
                      selected={selectedGroupId === g.id}
                      merging={merging}
                      mergeSelected={mergeIds.includes(g.id)}
                      onSelect={() => handleGroupClick(g.id)}
                      onToggle={() => patchGroup(g.id, { enabled: !g.enabled })}
                      onRename={name => patchGroup(g.id, { displayName: name })}
                      channelCount={stats.total}
                      enabledCount={stats.enabled}
                    />
                  )
                })}
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Right: channels */}
        <div className="min-h-0 flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {selectedGroup?.displayName ?? 'Select a group'}
                {showTrash && <span className="ml-2 text-xs font-normal text-red-500 uppercase tracking-wider">Trash</span>}
              </span>
              <div className="flex gap-2 text-xs items-center">
                {!showTrash && selectedGroupId && (
                  <>
                    <button onClick={() => bulkToggleChannels(filteredChannels, true)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">
                      {channelSearch ? `Enable (${filteredChannels.length})` : 'Enable all'}
                    </button>
                    <span className="text-gray-300 dark:text-gray-700">·</span>
                    <button onClick={() => bulkToggleChannels(filteredChannels, false)} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300">
                      {channelSearch ? `Disable (${filteredChannels.length})` : 'Disable all'}
                    </button>
                    <span className="text-gray-300 dark:text-gray-700">·</span>
                  </>
                )}
                <button
                  onClick={() => setShowTrash(!showTrash)}
                  className={`px-2 py-0.5 rounded transition-colors ${showTrash ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  {showTrash ? 'Exit Trash' : `Trash (${selectedGroupId ? (channelIndex.statsByGroup.get(selectedGroupId)?.deleted ?? 0) : 0})`}
                </button>
              </div>
            </div>
            <input value={channelSearch} onChange={e => setChannelSearch(e.target.value)}
              placeholder="Search channels..." className={inputCls} />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredChannels.map(ch => (
              <ChannelRow key={ch.id} channel={ch}
                onToggle={() => patchChannel(ch.id, { enabled: !ch.enabled })}
                onRename={name => patchChannel(ch.id, { displayName: name })}
                onDelete={() => patchChannel(ch.id, { isDeleted: !ch.isDeleted })}
                onPlay={() => setPlayingChannel(ch)}
                onFavorite={() => patchChannel(ch.id, { isFavorite: !ch.isFavorite })}
                epgTitle={groupEpg[ch.id]?.title}
              />
            ))}
            {filteredChannels.length === 0 && (
              <p className="text-gray-400 dark:text-gray-600 text-sm text-center py-8">
                {showTrash ? 'Trash is empty' : 'No channels'}
              </p>
            )}
          </div>
        </div>

        {/* Right: player */}
        {playingChannel && (
          <div className="min-h-0 flex flex-col">
            <ChannelPlayer
              key={playingChannel.id}
              title={playingChannel.displayName}
              channelId={playingChannel.id}
              bufferSize={data.bufferSize}
              playbackProfile={data.playbackProfile}
              proxyStreams={data.proxyStreams}
              url={channelPlaybackUrl(playingChannel.id, playingChannel.streamUrl, {
                playbackProfile: data.playbackProfile,
                proxyStreams: data.proxyStreams,
              })}
              onClose={() => setPlayingChannel(null)}
            />
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-sm shadow-lg text-gray-900 dark:text-gray-100">
          {toast}
        </div>
      )}
    </div>
  )
}

function ChannelRow({ channel, onToggle, onRename, onDelete, onPlay, onFavorite, epgTitle }: {
  channel: Channel
  onToggle: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onPlay: () => void
  onFavorite: () => void
  epgTitle?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(channel.displayName)

  return (
    <div className="flex min-h-9 items-center gap-3 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 group">
      {!channel.isDeleted && (
        <input type="checkbox" checked={channel.enabled} onChange={onToggle}
          className="rounded border-gray-300 dark:border-gray-600 accent-blue-500 shrink-0" />
      )}
      {channel.tvgLogo && (
        <span className="w-8 h-6 shrink-0 flex items-center justify-center bg-gray-900 rounded overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/proxy/logo?url=${encodeURIComponent(channel.tvgLogo)}`}
            alt=""
            width={24}
            height={24}
            className="w-full h-full object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </span>
      )}
      {editing
        ? <input autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(draft) }}
            onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onRename(draft) } if (e.key === 'Escape') { setEditing(false); setDraft(channel.displayName) } }}
            className="flex-1 bg-gray-100 dark:bg-gray-700 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0" />
        : <div className="flex-1 flex items-center justify-between min-w-0 gap-4">
            <span onDoubleClick={() => setEditing(true)}
                className={`text-sm truncate ${channel.isDeleted ? 'text-gray-400 italic' : ''}`} title="Double-click to rename">
                {channel.displayName}
            </span>
            {epgTitle && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate flex-1 text-right italic" title={epgTitle}>
                {epgTitle}
              </span>
            )}
          </div>
      }
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
        {!channel.isDeleted && (
          <>
            <button
              onClick={onFavorite}
              title={channel.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${channel.isFavorite ? 'text-yellow-500' : 'text-gray-400'}`}
            >
              <svg className="w-4 h-4" fill={channel.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
            <button
              onClick={onPlay}
              title="Play channel"
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-blue-500 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </>
        )}
        <button
          onClick={onDelete}
          title={channel.isDeleted ? 'Restore channel' : 'Delete channel'}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-colors"
        >
          {channel.isDeleted ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
