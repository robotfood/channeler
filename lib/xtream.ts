export type XtreamOutput = 'ts' | 'm3u8'

export interface XtreamCredentials {
  serverUrl: string
  username: string
  password: string
  output?: string | null
}

function normalizeServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl)
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function buildXtreamM3uUrl(creds: XtreamCredentials): string {
  const base = normalizeServerUrl(creds.serverUrl)
  const url = new URL(`${base}/get.php`)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  url.searchParams.set('type', 'm3u_plus')
  url.searchParams.set('output', creds.output === 'm3u8' ? 'm3u8' : 'ts')
  return url.toString()
}

export function buildXtreamEpgUrl(creds: XtreamCredentials): string {
  const base = normalizeServerUrl(creds.serverUrl)
  const url = new URL(`${base}/xmltv.php`)
  url.searchParams.set('username', creds.username)
  url.searchParams.set('password', creds.password)
  return url.toString()
}

export function hasXtreamCredentials(value: {
  xtreamServerUrl?: string | null
  xtreamUsername?: string | null
  xtreamPassword?: string | null
}): boolean {
  return Boolean(value.xtreamServerUrl && value.xtreamUsername && value.xtreamPassword)
}
