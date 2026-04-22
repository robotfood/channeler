export interface ParsedChannel {
  tvgId: string
  tvgName: string
  tvgLogo: string
  groupTitle: string
  displayName: string
  streamUrl: string
}

export function parseM3U(content: string): ParsedChannel[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  const channels: ParsedChannel[] = []
  let i = 0

  if (lines[0]?.startsWith('#EXTM3U')) i = 1

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('#EXTINF:')) {
      const streamUrl = lines[i + 1]
      if (streamUrl && !streamUrl.startsWith('#')) {
        channels.push({
          tvgId: attr(line, 'tvg-id'),
          tvgName: attr(line, 'tvg-name'),
          tvgLogo: attr(line, 'tvg-logo'),
          groupTitle: attr(line, 'group-title'),
          displayName: displayName(line),
          streamUrl,
        })
        i += 2
        continue
      }
    }
    i++
  }

  return channels
}

function attr(line: string, name: string): string {
  const m = line.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return m ? m[1] : ''
}

function displayName(line: string): string {
  const comma = line.lastIndexOf(',')
  return comma >= 0 ? line.slice(comma + 1).trim() : ''
}
