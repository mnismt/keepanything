import type { Item } from '../../../src/shared/types'

/** An `Item` row with every column defaulted; tests override what they care about. */
export function fakeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    type: 'text',
    subtype: null,
    kind: null,
    title: 'Untitled',
    originalPath: null,
    managedPath: null,
    url: null,
    canonicalUrl: null,
    domain: null,
    mimeType: null,
    size: null,
    contentHash: null,
    width: null,
    height: null,
    durationMs: null,
    pageCount: null,
    createdAt: '2026-09-03T10:00:00.000Z',
    capturedAt: '2026-09-03T10:00:00.000Z',
    modifiedAt: '2026-09-03T10:00:00.000Z',
    lastKeptAt: '2026-09-03T10:00:00.000Z',
    captureBatchId: null,
    processingStatus: 'CAPTURED',
    processingError: null,
    understanding: null,
    whyUseful: null,
    topics: [],
    entities: [],
    visionText: null,
    retrievalHints: [],
    aiConfidence: null,
    metadata: {},
    extractedText: null,
    excerpt: null,
    thumbnailPath: null,
    snapshotPath: null,
    faviconPath: null,
    dominantColor: null,
    mediaVersion: 1,
    parentItemId: null,
    userOverrides: {},
    isMissing: false,
    missingCheckedAt: null,
    deletedAt: null,
    ...overrides
  }
}

/** A `fetch` stub keyed by exact URL (or a predicate). Unknown URLs → 404. Records calls. */
export function fetchStub(routes: Record<string, () => Response | Promise<Response>>): {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    fetchImpl: async (input) => {
      calls.push(input)
      const exact = routes[input]
      if (exact) return exact()
      const prefix = Object.keys(routes).find((k) => k.endsWith('*') && input.startsWith(k.slice(0, -1)))
      if (prefix) return (routes[prefix] as () => Response | Promise<Response>)()
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }
  }
}

/** HTML response helper. */
export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/** JSON response helper. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
