import app, { createServerEntry } from '@tanstack/react-start/server-entry'

// Cloudflare does not redirect plain HTTP unless the zone has "Always Use HTTPS" on, and the
// workers.dev subdomain keeps serving after a custom domain is attached. Either one is a second
// origin for the same site, which gives a visitor a second cookie jar and so a second identity.
const CANONICAL_HOST = 'keepanything.app'

// PostHog ingestion, proxied first-party: `us.i.posthog.com` is on every ad-block list, a path on
// our own domain is not. `/static/` is the SDK's lazy-loaded chunks, which live on a second origin.
const INGEST_PREFIX = '/ingest'
const INGEST_ORIGIN = 'https://us.i.posthog.com'
const INGEST_ASSETS_ORIGIN = 'https://us-assets.i.posthog.com'

/** The canonical URL to send a request to, or null when it is already canonical. */
export function canonicalUrl(url: URL): string | null {
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null
  if (url.protocol === 'https:' && url.hostname === CANONICAL_HOST) return null
  const target = new URL(url)
  target.protocol = 'https:'
  target.hostname = CANONICAL_HOST
  target.port = ''
  return target.toString()
}

/** The PostHog URL a proxied `/ingest/...` request maps to. */
export function ingestUrl(url: URL): string {
  const path = url.pathname.slice(INGEST_PREFIX.length) || '/'
  const origin = path.startsWith('/static/') ? INGEST_ASSETS_ORIGIN : INGEST_ORIGIN
  return new URL(path + url.search, origin).toString()
}

export default createServerEntry({
  fetch: async (...args) => {
    const request = args[0]
    const url = new URL(request.url)

    // Before the redirect: these are POSTs, and a 301 would turn them into GETs.
    if (url.pathname === INGEST_PREFIX || url.pathname.startsWith(`${INGEST_PREFIX}/`)) {
      const proxied = new Request(ingestUrl(url), request)
      // /ingest is same-origin, so the browser attaches the site's cookies. PostHog does not read
      // them (the distinct id travels in the payload), so they would leak for nothing.
      proxied.headers.delete('cookie')
      return fetch(proxied)
    }

    const canonical = canonicalUrl(url)
    if (canonical) return Response.redirect(canonical, 301)

    return app.fetch(...args)
  }
})
