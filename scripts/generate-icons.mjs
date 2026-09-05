/**
 * Rasterises assets/icon/*.svg into the app icon and tray templates:
 *   build/icon.png + build/icon.icns        (1024 master; every iconset slice is rendered natively, not downscaled)
 *   assets/tray/trayTemplate{,@2x}.png       (18 / 36 px, black + alpha)
 *
 * Runs under the Electron binary, not node: the mark uses the bundled Instrument Serif, which
 * only Chromium can shape. Run: pnpm run icons
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeImage } from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const font = readFileSync(resolve(root, 'assets/fonts/InstrumentSerif-Italic.ttf')).toString('base64')
const fontFace = `<style>@font-face{font-family:"Instrument Serif";font-style:italic;src:url(data:font/ttf;base64,${font})}</style>`

// SVG loaded as an <img> is sandboxed from document fonts, so the face is embedded in the SVG itself.
function svgSource(name) {
  const raw = readFileSync(resolve(root, 'assets/icon', name), 'utf8')
  return raw.replace(/<svg([^>]*)>/, (m) => `${m}${fontFace}`)
}

const RENDER = `
  (async (svg, size) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d').drawImage(img, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  })`

async function render(win, svg, size) {
  const dataUrl = await win.webContents.executeJavaScript(`${RENDER}(${JSON.stringify(svg)}, ${size})`)
  return nativeImage.createFromDataURL(dataUrl).toPNG()
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('about:blank')

  mkdirSync(resolve(root, 'assets/tray'), { recursive: true })
  mkdirSync(resolve(root, 'build'), { recursive: true })

  const tray = svgSource('tray.svg')
  writeFileSync(resolve(root, 'assets/tray/trayTemplate.png'), await render(win, tray, 18))
  writeFileSync(resolve(root, 'assets/tray/trayTemplate@2x.png'), await render(win, tray, 36))

  const appSvg = svgSource('app.svg')
  writeFileSync(resolve(root, 'build/icon.png'), await render(win, appSvg, 1024))
  console.log('Wrote tray templates and build/icon.png')

  if (process.platform === 'darwin') {
    const iconset = resolve(root, 'build/icon.iconset')
    rmSync(iconset, { recursive: true, force: true })
    mkdirSync(iconset)
    for (const [name, px] of [
      ['icon_16x16', 16],
      ['icon_16x16@2x', 32],
      ['icon_32x32', 32],
      ['icon_32x32@2x', 64],
      ['icon_128x128', 128],
      ['icon_128x128@2x', 256],
      ['icon_256x256', 256],
      ['icon_256x256@2x', 512],
      ['icon_512x512', 512],
      ['icon_512x512@2x', 1024]
    ]) {
      writeFileSync(`${iconset}/${name}.png`, await render(win, appSvg, px))
    }
    execSync(`iconutil -c icns "${iconset}" -o "${resolve(root, 'build/icon.icns')}"`)
    rmSync(iconset, { recursive: true, force: true })
    console.log('Wrote build/icon.icns', existsSync(resolve(root, 'build/icon.icns')))
  }
  app.quit()
})
