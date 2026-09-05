/**
 * Generates the local placeholder icons with zero dependencies:
 *   assets/tray/trayTemplate.png      (18x18, monochrome template, 1x)
 *   assets/tray/trayTemplate@2x.png   (36x36, 2x)
 *   build/icon.png                    (1024x1024 app icon)
 *   build/icon.icns                   (via macOS `iconutil`, if available)
 *
 * Run: node scripts/generate-icons.mjs
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --- Minimal PNG encoder (RGBA, 8-bit) --------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeData))
  return Buffer.concat([len, typeData, crc])
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- Rasteriser with 4x4 supersampling --------------------------------------
/** shade(x, y) -> [r, g, b, a] in 0..1 for a point in normalised 0..1 space. */
function raster(size, shade) {
  const SS = 4
  const out = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size
          const [cr, cg, cb, ca] = shade(x, y)
          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }
      const n = SS * SS
      const i = (py * size + px) * 4
      if (a > 0) {
        out[i] = Math.round((r / a) * 255)
        out[i + 1] = Math.round((g / a) * 255)
        out[i + 2] = Math.round((b / a) * 255)
      }
      out[i + 3] = Math.round((a / n) * 255)
    }
  }
  return out
}

/** Distance-based ring arc shader in normalised coordinates. */
function ringArc(x, y, { cx, cy, radius, thickness, startDeg, sweepDeg }) {
  const dx = x - cx
  const dy = y - cy
  const d = Math.hypot(dx, dy)
  const inRing = Math.abs(d - radius) <= thickness / 2
  if (!inRing) return false
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90 // 0 at top, clockwise
  angle = ((angle % 360) + 360) % 360
  const rel = (((angle - startDeg) % 360) + 360) % 360
  if (rel <= sweepDeg) return true
  // Round caps
  for (const capDeg of [startDeg, startDeg + sweepDeg]) {
    const t = ((capDeg - 90) * Math.PI) / 180
    const capX = cx + Math.cos(t) * radius
    const capY = cy + Math.sin(t) * radius
    if (Math.hypot(x - capX, y - capY) <= thickness / 2) return true
  }
  return false
}

// --- Tray template icon: black ring with a 270deg arc + centre dot ------------
function trayShade(x, y) {
  const arc = ringArc(x, y, { cx: 0.5, cy: 0.5, radius: 0.34, thickness: 0.13, startDeg: 0, sweepDeg: 270 })
  const dot = Math.hypot(x - 0.5, y - 0.5) <= 0.11
  return arc || dot ? [0, 0, 0, 1] : [0, 0, 0, 0]
}

// --- App icon: rounded near-black square with the ring in white/orange -------
function roundedRect(x, y, r) {
  const qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0)
  const qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  return Math.hypot(qx, qy) <= r
}
function appShade(x, y) {
  // macOS icon grid: content inside ~80% of the canvas.
  const inset = 0.1
  const nx = (x - inset) / (1 - 2 * inset)
  const ny = (y - inset) / (1 - 2 * inset)
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1 || !roundedRect(nx, ny, 0.225)) return [0, 0, 0, 0]
  if (ringArc(nx, ny, { cx: 0.5, cy: 0.5, radius: 0.3, thickness: 0.085, startDeg: 0, sweepDeg: 263 }))
    return [1, 0.294, 0.125, 1]
  if (Math.abs(Math.hypot(nx - 0.5, ny - 0.5) - 0.3) <= 0.0425) return [0.17, 0.17, 0.19, 1]
  return [0.047, 0.047, 0.055, 1]
}

mkdirSync(resolve(root, 'assets/tray'), { recursive: true })
mkdirSync(resolve(root, 'build'), { recursive: true })

writeFileSync(resolve(root, 'assets/tray/trayTemplate.png'), encodePng(18, 18, raster(18, trayShade)))
writeFileSync(resolve(root, 'assets/tray/trayTemplate@2x.png'), encodePng(36, 36, raster(36, trayShade)))
writeFileSync(resolve(root, 'build/icon.png'), encodePng(1024, 1024, raster(1024, appShade)))
console.log('Wrote tray icons and build/icon.png')

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
    execSync(`sips -z ${px} ${px} "${resolve(root, 'build/icon.png')}" --out "${iconset}/${name}.png"`, {
      stdio: 'ignore'
    })
  }
  execSync(`iconutil -c icns "${iconset}" -o "${resolve(root, 'build/icon.icns')}"`)
  rmSync(iconset, { recursive: true, force: true })
  console.log('Wrote build/icon.icns', existsSync(resolve(root, 'build/icon.icns')))
}
