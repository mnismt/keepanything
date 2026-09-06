import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { ReactLenis } from 'lenis/react'
import type { ReactNode } from 'react'
import appCss from '../styles/global.css?url'

const TITLE = 'KeepAnything'
const DESCRIPTION = "Keep anything. We'll figure out the rest. A local-first library for your Mac."
// Set to the deployed origin (no trailing slash) once the worker is live; Facebook needs og:image absolute.
const SITE = ''
const OG_IMAGE = `${SITE}/og.png`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:width', content: '2400' },
      { property: 'og:image:height', content: '1260' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: OG_IMAGE }
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'stylesheet', href: appCss },
      // In dev the plugin serves compiled rules from a virtual endpoint; in prod they are appended to global.css.
      ...(import.meta.env.DEV ? [{ rel: 'stylesheet', href: '/virtual:stylex.css' }] : [])
    ]
  }),
  shellComponent: RootDocument
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Pins `reset` below StyleX's priority layers whatever order the stylesheets land in (ADR 011). */}
        <style>{'@layer reset;'}</style>
        <HeadContent />
      </head>
      <body>
        <ReactLenis root>{children}</ReactLenis>
        <Scripts />
      </body>
    </html>
  )
}
