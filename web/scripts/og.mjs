// Renders public/og.png (1200x630) from the inline SVG below. Run: node scripts/og.mjs
// Playwright Chromium is used because no rasterizer in the toolchain loads Instrument Serif.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.dirname(fileURLToPath(import.meta.url))
const fonts = path.join(root, '../public/fonts')
const out = path.join(root, '../public/og.png')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs><clipPath id="c"><rect x="80" y="72" width="72" height="42"/></clipPath></defs>
  <rect width="1200" height="630" fill="#141210"/>

  <!-- brand mark: the favicon at 2x -->
  <rect x="80" y="72" width="72" height="72" rx="18" fill="#d9a35a"/>
  <g clip-path="url(#c)" fill="#ece7dd">
    <rect x="100" y="82" width="32" height="30" rx="4"/>
    <circle cx="116" cy="96" r="14"/>
    <rect x="94" y="90" width="44" height="18" rx="4"/>
  </g>
  <rect x="92" y="112" width="48" height="6" rx="3" fill="#1d1a17"/>

  <!-- wordmark -->
  <text x="168" y="100" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"
        font-size="22" font-weight="600" letter-spacing="-0.2" fill="rgba(239,233,225,0.64)">Keep</text>
  <text x="168" y="128" font-family="'Instrument Serif', Georgia, serif" font-style="italic"
        font-size="26" fill="rgba(239,233,225,0.48)">Anything</text>

  <!-- headline -->
  <text x="78" y="372" font-family="'Instrument Serif', Georgia, serif" font-size="112"
        letter-spacing="-2.2" fill="#efe9e1">Keep anything.</text>
  <text x="80" y="470" font-family="'Instrument Serif', Georgia, serif" font-style="italic" font-size="92"
        letter-spacing="-1.8" fill="rgba(239,233,225,0.48)">We’ll figure out the rest.</text>

  <!-- footer -->
  <rect x="80" y="534" width="1040" height="1" fill="rgba(255,255,255,0.12)"/>
  <text x="80" y="574" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"
        font-size="20" fill="rgba(239,233,225,0.64)">A local-first library for your Mac.</text>
</svg>`

const html = `<!doctype html><style>
@font-face{font-family:'Instrument Serif';src:url('file://${fonts}/InstrumentSerif-Regular.ttf')}
@font-face{font-family:'Instrument Serif';font-style:italic;src:url('file://${fonts}/InstrumentSerif-Italic.ttf')}
html,body{margin:0;background:#141210}svg{display:block}
</style>${svg}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
await page.locator('svg').screenshot({ path: out, omitBackground: false })
await browser.close()
console.log('wrote', out)
