import { cloudflare } from '@cloudflare/vite-plugin'
import stylex from '@stylexjs/unplugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// StyleX runs first so Fast Refresh sees compiled output (mirrors `electron.vite.config.ts`).
// `devPersistToDisk` lets the SSR and client environments share compiled rules in dev.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    stylex.vite({ useCSSLayers: true, devMode: 'full', devPersistToDisk: true }),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact()
  ]
})
