import { resolve } from 'node:path'
import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * Production Content Security Policy. Injected as a <meta> tag only for production builds;
 * development additionally needs inline scripts for Vite/React Fast Refresh, handled by response
 * headers in the main process. Keep in sync with `PRODUCTION_CSP` in `src/main/security.ts`.
 */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: ka-media:",
  'media-src ka-media:',
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

function cspMetaPlugin(): Plugin {
  return {
    name: 'keepanything-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<!-- CSP -->', `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`)
    }
  }
}

export default defineConfig({
  main: {
    // `dependencies` (only @huggingface/transformers and its natives) stay external; devDependencies are bundled.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two entries: the main process and the utility-process worker (out/main/index.js, out/main/worker.js).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/main/worker/index.ts')
        },
        // zod's published sources explain their esbuild workarounds in prose that quotes `@__PURE__`
        // (v4/core/util.js, v4/core/regexes.js). Rollup scans every comment for annotations, finds the
        // token in a position it cannot attach to a call, and warns that it is dropping the comment.
        // The real annotations sit on the call sites and survive, so this is noise on each rebuild.
        // Scoped to node_modules so a misplaced annotation in our own source still surfaces.
        onwarn(warning, defaultHandler) {
          if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/node_modules/')) return
          defaultHandler(warning)
        }
      }
    }
  },
  preload: {
    // Sandboxed preload: imports only `electron` and dependency-free `src/shared/*` (no zod).
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // StyleX compiles `stylex.create` at build time and appends the CSS to the renderer's CSS asset.
    // It must run before the React plugin so Fast Refresh still works. Tokens live in
    // `src/renderer/src/styles/*.stylex.ts`; in dev the virtual CSS is loaded from `main.tsx`.
    plugins: [stylex.vite({ useCSSLayers: true, devMode: 'full' }), react(), cspMetaPlugin()],
    build: {
      minify: 'esbuild',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
