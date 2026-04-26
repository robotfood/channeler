# Channeler App Flow

Pseudo-code summary of how the app works, including the React and Next.js architecture.

```txt
Channeler App
=============

Runtime:
  Next.js App Router:
    The app uses the /app directory instead of the older /pages router.
    Each route is represented by filesystem conventions:
      app/page.tsx                       -> GET /
      app/playlists/[id]/page.tsx        -> GET /playlists/:id
      app/settings/page.tsx              -> GET /settings
      app/api/.../route.ts               -> server route handlers / API endpoints

    Dynamic segments like [id] receive params as a Promise in this Next.js version.
    Server pages read them with:
      const { id } = await props.params

    Route Handlers under app/api use Web Request/Response APIs plus NextRequest/NextResponse.
    They are used for mutations, playlist output generation, logo proxying, and stream proxying.

  React Server Components by default:
    Files like app/page.tsx are Server Components unless they start with "use client".
    Server Components run only on the server.
    They can query SQLite/Drizzle directly.
    They can read request headers, environment variables, and backend-only modules.
    Their database/query code is not shipped to the browser.

    In this app, Server Components are used for initial page data:
      /                         loads playlist summaries
      /playlists/:id            loads playlist, groups, and channels
      /settings                 loads global settings and refresh log
      /playlists/:id/settings   loads playlist settings

    Some DB-backed pages call connection() from next/server.
    This tells Next.js to render the page at request time instead of prerendering it at build time.
    That matters because the real SQLite database exists at runtime, not during static generation.

  React Client Components:
    Files that need browser interactivity start with "use client".
    Client Components can use:
      useState
      useMemo
      event handlers
      drag/drop
      file inputs
      clipboard APIs
      confirm()
      router.push()

    Client Components should not import lib/db or query SQLite directly.
    They receive initial data from Server Components, then call app/api route handlers after user actions.

  Overall render model:
    Initial page load:
      browser requests route
      Next.js runs the Server Component
      Server Component queries DB directly
      Server Component renders HTML with real data
      Client Component receives initial data as props
      browser hydrates Client Component
      UI becomes interactive

    Later user actions:
      user clicks, edits, drags, or submits
      Client Component updates local React state
      Client Component calls an app/api route handler
      route handler updates DB/files/network data
      Client Component shows updated UI or toast

  Data/storage:
    SQLite database accessed through Drizzle.
    Raw playlist/EPG files are handled by server-side library code.
    Stream and logo proxying is done through route handlers.


Root Layout
-----------

app/layout.tsx:

  render <html>
    inject small theme script before first paint
    render nav:
      Channeler
      Playlists link
      Settings link
      ThemeToggle client component
    render page children inside <main>


Dashboard Page
--------------

GET /

app/page.tsx is a Server Component:

  await connection()
    // tells Next.js this page must render at request time,
    // not during build/prerender

  headers = await headers()
  host = x-forwarded-host OR host OR localhost

  playlists = await getDashboardPlaylists()
    // direct DB query on the server

  return <DashboardClient initialPlaylists={playlists} host={host} />


app/dashboard-client.tsx is a Client Component:

  state playlists = initialPlaylists

  render playlist cards:
    name
    enabled channel count
    group count
    M3U output URL
    EPG output URL if available

  Copy button:
    uses navigator.clipboard or textarea fallback

  Delete button:
    confirm()
    fetch DELETE /api/playlists/:id
    remove playlist from local React state


Playlist Editor Page
--------------------

GET /playlists/:id

app/playlists/[id]/page.tsx is a Server Component:

  params = await props.params
  playlistId = parseInt(params.id)

  if invalid:
    notFound()

  data = await getPlaylistData(playlistId)
    // loads playlist + groups + channels directly from DB

  if missing:
    notFound()

  return <PlaylistEditorClient initialData={data} playlistId={id} />


app/playlists/[id]/playlist-editor-client.tsx is a Client Component:

  state data = initialData
  state selectedGroupId = first group id
  state groupSearch
  state channelSearch
  state refreshing
  state toast
  state merging / mergeIds

  derived data with useMemo:
    channels grouped by groupId
    enabled counts per group
    total enabled count
    filtered groups
    filtered channels

  render:
    top toolbar:
      back link
      playlist name
      channel count
      Refresh M3U button
      Refresh EPG button
      Settings link

    left panel:
      searchable group list
      enable/disable groups
      drag/drop sorting with dnd-kit
      merge mode
      inline rename
      group enabled checkbox

    right panel:
      selected group channels
      searchable channel list
      enable/disable channels
      inline rename
      logo image through /api/proxy/logo

  user actions:
    rename group:
      optimistic local state update
      PATCH /api/groups/:id

    toggle group:
      optimistic local state update
      PATCH /api/groups/:id

    reorder groups:
      optimistic local state update
      POST /api/groups/sort

    merge groups:
      POST /api/groups/merge
      update local groups/channels state

    rename/toggle channel:
      optimistic local state update
      PATCH /api/channels/:id

    refresh M3U:
      POST /api/playlists/:id/refresh-m3u
      refetch /api/playlists/:id
      update local data

    refresh EPG:
      POST /api/playlists/:id/refresh-epg
      show toast


New Playlist Page
-----------------

GET /playlists/new

app/playlists/new/page.tsx is a Client Component:

  form state:
    name
    sourceKind = m3u | xtream
    M3U URL or uploaded file
    Xtream server/username/password/output
    optional EPG URL or uploaded file
    loading/error

  submit:
    build FormData
    POST /api/playlists
    if success:
      router.push(/playlists/:newId)

  This stays client-side because it uses:
    form state
    file inputs
    router.push
    browser events


Playlist Settings Page
----------------------

GET /playlists/:id/settings

app/playlists/[id]/settings/page.tsx is a Server Component:

  params = await props.params
  playlist = await getPlaylistData(id)

  if missing:
    notFound()

  remove groups/channels from data shape

  return <PlaylistSettingsClient initialData={settings} playlistId={id} />


playlist-settings-client.tsx is a Client Component:

  state initialized from server data:
    name
    URLs
    Xtream credentials
    autoRefresh
    proxyStreams

  Save:
    PATCH /api/playlists/:id

  Delete:
    confirm()
    DELETE /api/playlists/:id
    router.push('/')

  Upload EPG UI currently calls:
    POST /api/playlists/:id/refresh-epg


Global Settings Page
--------------------

GET /settings

app/settings/page.tsx is a Server Component:

  await connection()
  data = await getSettingsData()
    // settings + recent refresh log

  return <SettingsClient initialData={data} />


settings-client.tsx is a Client Component:

  state settings = initialData.settings
  log = initialData.log

  render:
    M3U auto-refresh toggle
    M3U interval select
    EPG auto-refresh toggle
    EPG interval select
    refresh log table

  Save:
    PATCH /api/settings
    show toast


Shared Server Data
------------------

lib/app-data.ts:

  getDashboardPlaylists():
    query playlists
    query channel counts grouped by playlist
    query group counts grouped by playlist
    return dashboard-ready playlist summaries

  getPlaylistData(playlistId):
    query playlist
    query groups ordered by sortOrder
    query channels ordered by sortOrder
    return playlist + groups + channels

  getSettingsData():
    query settings
    query latest refresh log entries
    return settings object + log array


API Route Handlers
------------------

Route handlers live under app/api.
They run on the server and are called by Client Components after user actions.

GET /api/playlists:
  return getDashboardPlaylists()

POST /api/playlists:
  parse FormData
  create playlist row
  ingest M3U or Xtream channels
  optionally ingest EPG
  return new playlist id

GET /api/playlists/:id:
  return getPlaylistData(id)

PATCH /api/playlists/:id:
  update playlist settings
  rebuild Xtream EPG URL when needed

DELETE /api/playlists/:id:
  delete playlist
  cascade deletes groups/channels via DB relations

PATCH /api/groups/:id:
  update group fields

POST /api/groups/sort:
  update group sort order

POST /api/groups/merge:
  move channels from source group to target group
  delete source group

PATCH /api/channels/:id:
  update channel fields

POST /api/playlists/:id/refresh-m3u:
  fetch/reingest playlist source
  write refresh log

POST /api/playlists/:id/refresh-epg:
  fetch/reingest EPG source
  write refresh log

GET /api/output/:id/m3u:
  find playlist by id or slug
  load enabled groups/channels
  generate M3U text
  if proxyStreams enabled:
    output stream URLs as /api/stream/:channelId
  else:
    output original stream URLs

GET /api/output/:id/xml:
  load raw EPG XML file
  load enabled channel tvgIds
  filter XMLTV channels/programmes to enabled ids
  return XML

GET /api/proxy/logo:
  fetch remote logo URL
  return image response

GET /api/stream/:channelId:
  load channel stream URL
  proxy upstream stream response

GET /api/stream/segment:
  proxy stream segment URLs


React / Next.js Architecture
----------------------------

Server Components:
  used for initial route rendering
  can query SQLite directly
  do not ship their DB/query code to the browser
  improve first render because HTML includes real data

Client Components:
  marked with "use client"
  receive initial server data as props
  manage React state
  handle clicks, drag/drop, forms, clipboard, confirm dialogs, router navigation
  call API route handlers for mutations

Initial page load pattern:

  browser requests page
  Next.js runs Server Component
  Server Component queries DB
  Server Component renders real playlist/settings data
  browser receives HTML with real data
  React hydrates Client Component
  UI becomes interactive

After user interaction:

  user clicks/edits/drags
  Client Component updates local state
  Client Component calls app/api route handler
  route handler updates DB/files/network data
  Client Component shows updated UI or toast
```
