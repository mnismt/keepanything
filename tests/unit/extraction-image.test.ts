import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyImage, imageExtractor, inspectImage, isScreenshotName } from '../../src/main/extraction/image'
import {
  exifDateToIso,
  parseExif,
  parseImageInfo,
  sniffImageFormat,
  sniffPdf
} from '../../src/main/extraction/image-dims'
import { createManualClock } from '../../src/main/lib/clock'
import { silentLogger } from '../../src/main/lib/logger'
import { fakeItem } from './helpers/fake-item'

const SCREENSHOT = resolve(__dirname, '../fixtures/corpus/files/screenshots/terminal-pnpm-test.png')

/** Minimal JPEG: SOI, APP1 (Exif with Make + DateTimeOriginal), SOF0 640×480, EOI. */
function jpegWithExif(): Uint8Array {
  const tiff: number[] = []
  const u16 = (n: number): number[] => [n & 0xff, n >> 8]
  const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
  // Little-endian TIFF header, IFD0 at offset 8 with 2 entries: Make (0x010f) + ExifIFD pointer (0x8769).
  tiff.push(0x49, 0x49, 0x2a, 0x00, ...u32(8))
  const make = 'Apple\0'
  const date = '2026:08:14 10:02:11\0'
  const ifd0Start = 8
  const ifd0Size = 2 + 2 * 12 + 4
  const makeOffset = ifd0Start + ifd0Size
  const exifIfdOffset = makeOffset + make.length
  tiff.push(...u16(2))
  tiff.push(...u16(0x010f), ...u16(2), ...u32(make.length), ...u32(makeOffset))
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdOffset))
  tiff.push(...u32(0))
  tiff.push(...[...make].map((c) => c.charCodeAt(0)))
  const dateOffset = exifIfdOffset + 2 + 12 + 4
  tiff.push(...u16(1))
  tiff.push(...u16(0x9003), ...u16(2), ...u32(date.length), ...u32(dateOffset))
  tiff.push(...u32(0))
  tiff.push(...[...date].map((c) => c.charCodeAt(0)))
  const app1Body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
  const app1Len = app1Body.length + 2
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01
  ]
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, ...app1Body, ...sof, 0xff, 0xd9])
}

describe('image headers', () => {
  it('sniffs formats and parses PNG/GIF/WebP/BMP dimensions', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0xa0, 0, 0, 3, 0x84,
      8, 6, 0, 0, 0
    ])
    expect(parseImageInfo(png)).toMatchObject({ format: 'png', width: 1440, height: 900 })
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00, 0, 0, 0, 0])
    expect(parseImageInfo(gif)).toMatchObject({ format: 'gif', width: 16, height: 32 })
    const webp = new Uint8Array(32)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 0)
    webp.set([0x1f, 0x03, 0x00, 0x57, 0x02, 0x00], 24) // 800×600 (minus one encoding)
    expect(parseImageInfo(webp)).toMatchObject({ format: 'webp', width: 800, height: 600 })
    const bmp = new Uint8Array(30)
    bmp.set([0x42, 0x4d], 0)
    new DataView(bmp.buffer).setInt32(18, 320, true)
    new DataView(bmp.buffer).setInt32(22, -240, true)
    expect(parseImageInfo(bmp)).toMatchObject({ format: 'bmp', width: 320, height: 240 })
    expect(
      sniffImageFormat(
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"></svg>')
      )
    ).toBe('svg')
    expect(
      parseImageInfo(new TextEncoder().encode('<?xml version="1.0"?><svg viewBox="0 0 300 150"></svg>'))
    ).toMatchObject({
      format: 'svg',
      width: 300,
      height: 150
    })
    expect(sniffPdf(new TextEncoder().encode('%PDF-1.5 …'))).toBe(true)
    expect(parseImageInfo(new TextEncoder().encode('plain text file that is long enough'))).toBeNull()
  })

  it('parses JPEG dimensions and EXIF facts', () => {
    const info = parseImageInfo(jpegWithExif())
    expect(info).toMatchObject({ format: 'jpeg', width: 640, height: 480 })
    expect(info?.exif).toEqual({ make: 'Apple', takenAt: '2026-08-14T10:02:11' })
    expect(exifDateToIso('0000:00:00 00:00:00')).toBeUndefined()
    expect(parseExif(new Uint8Array(4))).toBeNull()
  })

  it('classifies screenshots, photos and designs', () => {
    expect(isScreenshotName('Screenshot 2026-08-14 at 10.02.11.png')).toBe(true)
    expect(isScreenshotName('Screen Shot 2021-01-01 at 9.00.00 AM.png')).toBe(true)
    expect(isScreenshotName('CleanShot 2026-08-14 at 10.02.11@2x.png')).toBe(true)
    expect(isScreenshotName('Bildschirmfoto 2026-08-14 um 10.02.11.png')).toBe(true)
    expect(isScreenshotName('IMG_0042.jpg')).toBe(false)
    expect(isScreenshotName('hero-banner.png')).toBe(false)
    expect(classifyImage('x.png', { format: 'png', width: 2880, height: 1800 })).toBe('screenshot')
    expect(classifyImage('x.png', { format: 'png', width: 300, height: 300 })).toBe('generic')
    expect(classifyImage('x.jpg', { format: 'jpeg', width: 4032, height: 3024, exif: { make: 'Apple' } })).toBe('photo')
    expect(classifyImage('x.jpg', { format: 'jpeg', width: 4032, height: 3024 })).toBe('photo')
    expect(classifyImage('logo.svg', { format: 'svg', width: 10, height: 10 })).toBe('design')
    expect(classifyImage('IMG_1.jpg', { format: 'jpeg', width: 100, height: 100 })).toBe('photo')
  })

  it('inspects the demo screenshot fixture and runs the adapter', async () => {
    const { info, subtype } = await inspectImage(SCREENSHOT)
    expect(info).toMatchObject({ format: 'png', width: 1440, height: 900 })
    expect(subtype).toBe('screenshot')
    const out = await imageExtractor.extract(
      { item: fakeItem({ type: 'image', metadata: { originalName: 'terminal-pnpm-test.png' } }), filePath: SCREENSHOT },
      { logger: silentLogger, clock: createManualClock() }
    )
    expect(out.dims).toEqual({ width: 1440, height: 900 })
    expect(out.item?.subtype).toBe('screenshot')
    expect(out.text).toBe('')
  })
})
