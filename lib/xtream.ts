export type XtreamOutput = 'ts' | 'm3u8'

export interface XtreamCredentials {
  serverUrl: string
  username: string
  password: string
  output?: string | null
}

export interface XtreamPlayerApiResponse {
  user_info?: {
    auth?: number | string | boolean
    status?: string
    message?: string
  }
  server_info?: {
    url?: string
    port?: string | number
    https_port?: string | number
    server_protocol?: string
  }
}

export interface XtreamCategory {
  category_id: string | number
  category_name: string
}

export interface XtreamLiveStream {
  stream_id: string | number
  name: string
  category_id?: string | number | null
  stream_icon?: string | null
  epg_channel_id?: string | null
}

function normalizeServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl)
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function normalizeXtreamServerUrl(serverUrl: string): string {
  return normalizeServerUrl(serverUrl)
}

export function buildXtreamPlayerApiUrl(creds: XtreamCredentials, action?: string): string {
  const base = normalizeServerUrl(creds.serverUrl)
  const url = new URL(`${base}/player_api.php`)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  if (action) url.searchParams.set('action', action)
  return url.toString()
}

export function buildXtreamEpgUrl(creds: XtreamCredentials): string {
  const base = normalizeServerUrl(creds.serverUrl)
  const url = new URL(`${base}/xmltv.php`)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  return url.toString()
}

export function buildXtreamLiveStreamUrl(
  creds: XtreamCredentials,
  serverInfo: XtreamPlayerApiResponse['server_info'],
  streamId: string | number
): string {
  const normalized = new URL(normalizeServerUrl(creds.serverUrl))
  const protocol = serverInfo?.server_protocol || normalized.protocol.replace(':', '') || 'http'
  const host = serverInfo?.url || normalized.hostname
  const port = protocol === 'https'
    ? String(serverInfo?.https_port || normalized.port || '443')
    : String(serverInfo?.port || normalized.port || '80')

  return `${protocol}://${host}:${port}/live/${creds.username}/${creds.password}/${streamId}.${creds.output === 'm3u8' ? 'm3u8' : 'ts'}`
}

export function hasXtreamCredentials(value: {
  xtreamServerUrl?: string | null
  xtreamUsername?: string | null
  xtreamPassword?: string | null
}): boolean {
  return Boolean(value.xtreamServerUrl && value.xtreamUsername && value.xtreamPassword)
}
