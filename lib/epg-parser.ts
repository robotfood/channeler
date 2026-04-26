// Helper to parse XMLTV dates like "20260426133000 +0000"
export function parseXMLTVDate(xmltvDate: string): Date {
  const parts = xmltvDate.split(' ')
  const dateStr = parts[0]
  const year = parseInt(dateStr.slice(0, 4))
  const month = parseInt(dateStr.slice(4, 6)) - 1
  const day = parseInt(dateStr.slice(6, 8))
  const hour = parseInt(dateStr.slice(8, 10))
  const minute = parseInt(dateStr.slice(10, 12))
  const second = parseInt(dateStr.slice(12, 14)) || 0

  if (parts.length > 1) {
    const tz = parts[1]
    const sign = tz.startsWith('+') ? 1 : -1
    const tzHour = parseInt(tz.slice(1, 3))
    const tzMin = parseInt(tz.slice(3, 5))
    const offsetMs = sign * (tzHour * 60 + tzMin) * 60 * 1000
    
    // Create UTC date and then subtract the offset to get the actual UTC time
    const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second))
    return new Date(utcDate.getTime() - offsetMs)
  }

  return new Date(year, month, day, hour, minute, second)
}
