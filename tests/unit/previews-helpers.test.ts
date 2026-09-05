import { describe, expect, it } from 'vitest'
import { dominantColor, rgbToHex } from '../../src/main/previews/color'
import {
  managedFile,
  snapshotFile,
  snapshotFullRelPath,
  snapshotRelPath,
  thumbnailFile,
  thumbnailRelPath,
  visionFile,
  visionRelPath
} from '../../src/main/previews/paths'
import { buildPaths } from '../../src/main/storage/paths'

function bitmap(pixels: [number, number, number, number][], order: 'rgba' | 'bgra' = 'rgba'): Uint8Array {
  const out = new Uint8Array(pixels.length * 4)
  pixels.forEach(([r, g, b, a], i) => {
    out.set(order === 'rgba' ? [r, g, b, a] : [b, g, r, a], i * 4)
  })
  return out
}

describe('dominant colour', () => {
  it('formats hex and picks the most common bucket', () => {
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000')
    expect(rgbToHex(-5, 300, 12.6)).toBe('#00ff0d')
    const px = bitmap([
      [200, 30, 30, 255],
      [201, 31, 29, 255],
      [10, 10, 250, 255],
      [0, 0, 0, 0]
    ])
    expect(dominantColor(px, 2, 2)).toBe('#c91f1e')
  })

  it('reads BGRA and prefers a saturated bucket over paper white', () => {
    const rgba = bitmap([
      [255, 255, 255, 255],
      [254, 254, 254, 255],
      [253, 253, 253, 255],
      [30, 120, 200, 255]
    ])
    expect(dominantColor(rgba, 2, 2)).toBe('#1e78c8')
    const bgra = bitmap([[30, 120, 200, 255]], 'bgra')
    expect(dominantColor(bgra, 1, 1, 'bgra')).toBe('#1e78c8')
    expect(dominantColor(bgra, 1, 1, 'rgba')).toBe('#c8781e')
  })

  it('returns null for empty or fully transparent input', () => {
    expect(dominantColor(new Uint8Array(0), 0, 0)).toBeNull()
    expect(dominantColor(bitmap([[1, 2, 3, 0]]), 1, 1)).toBeNull()
    expect(dominantColor(new Uint8Array(3), 1, 1)).toBeNull()
  })
})

describe('preview paths', () => {
  const paths = buildPaths('/tmp/ka-root')
  it('builds relative and absolute preview paths', () => {
    expect(thumbnailRelPath('abc')).toBe('abc.png')
    expect(thumbnailFile(paths, 'abc')).toBe('/tmp/ka-root/thumbs/abc.png')
    expect(snapshotRelPath('abc')).toBe('abc.png')
    expect(snapshotFile(paths, 'abc')).toBe('/tmp/ka-root/snapshots/abc.png')
    expect(snapshotFullRelPath('abc')).toBe('abc.full.jpg')
    expect(visionRelPath('abc')).toBe('abc.vision.jpg')
    expect(visionFile(paths, 'abc')).toBe('/tmp/ka-root/content/abc.vision.jpg')
  })
  it('resolves managed paths and refuses traversal', () => {
    expect(managedFile(paths, 'id1/report.pdf')).toBe('/tmp/ka-root/objects/id1/report.pdf')
    expect(managedFile(paths, '../library.db')).toBeNull()
    expect(managedFile(paths, 'id1/../../x')).toBeNull()
    expect(managedFile(paths, '/etc/passwd')).toBeNull()
    expect(managedFile(paths, '')).toBeNull()
  })
})
