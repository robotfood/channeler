import { summarizeUrl } from './stream-proxy'

type MultiplexedStream = {
  clients: Set<ReadableStreamDefaultController<Uint8Array>>
  upstreamAbort: AbortController
  contentType: string | null
}

const activeStreams = new Map<string, MultiplexedStream>()

function requestKey(url: string, headers: Headers) {
  return JSON.stringify({
    url,
    accept: headers.get('accept') ?? '',
    cookie: headers.get('cookie') ?? '',
    origin: headers.get('origin') ?? '',
    range: headers.get('range') ?? '',
    referer: headers.get('referer') ?? '',
    userAgent: headers.get('user-agent') ?? '',
  })
}

/**
 * Multiplexes a continuous stream (e.g. raw TS) among multiple clients.
 * When the first client connects, an upstream connection is opened.
 * Subsequent clients share the same data chunks.
 */
export async function getSharedStream(url: string, headers: Headers): Promise<{ stream: ReadableStream<Uint8Array>, contentType: string | null }> {
  const key = requestKey(url, headers)
  let entry = activeStreams.get(key)

  if (!entry) {
    const abort = new AbortController()
    const upstream = await fetch(url, {
      headers,
      signal: abort.signal,
      redirect: 'follow'
    })

    if (!upstream.ok || !upstream.body) {
      throw new Error(`Upstream error: ${upstream.status}`)
    }

    const contentType = upstream.headers.get('content-type')
    const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
    entry = { clients, upstreamAbort: abort, contentType }
    activeStreams.set(key, entry)

    // Start reading upstream in the background
    const reader = upstream.body.getReader()
    
    ;(async () => {
      try {
        console.log(`[multiplexer] Starting upstream connection: ${summarizeUrl(url)}`)
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Broadcast to all active clients
          for (const client of clients) {
            try {
              client.enqueue(value)
            } catch {
              // Client might have disconnected
              clients.delete(client)
            }
          }

          if (clients.size === 0) break
        }
      } catch (err) {
        console.error(`[multiplexer] Upstream read error: ${err}`)
      } finally {
        abort.abort()
        activeStreams.delete(key)
        for (const client of clients) {
          try { client.close() } catch {}
        }
      }
    })()
  }

  let clientController: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clientController = controller
      entry!.clients.add(controller)
    },
    cancel() {
      if (clientController) entry!.clients.delete(clientController)
      if (entry!.clients.size === 0) {
        console.log(`[multiplexer] All clients disconnected, closing upstream: ${summarizeUrl(url)}`)
        entry!.upstreamAbort.abort()
      }
    }
  })

  return { stream, contentType: entry.contentType }
}

/**
 * Short-lived cache for HLS segments (.ts files) to deduplicate near-simultaneous requests.
 */
type CachedSegment = {
  data: ArrayBuffer
  contentType: string | null
}

const segmentCache = new Map<string, Promise<CachedSegment>>()

export async function getCachedSegment(url: string, headers: Headers): Promise<CachedSegment> {
  const key = requestKey(url, headers)
  let pending = segmentCache.get(key)

  if (!pending) {
    pending = (async () => {
      const res = await fetch(url, { headers, redirect: 'follow' })
      if (!res.ok) throw new Error(`Upstream error: ${res.status}`)
      
      return {
        data: await res.arrayBuffer(),
        contentType: res.headers.get('content-type'),
      }
    })()

    segmentCache.set(key, pending)
    
    // Auto-cleanup
    setTimeout(() => segmentCache.delete(key), 35_000)
  }

  return pending
}
