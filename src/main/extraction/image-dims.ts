/**
 * Image header parsing without native dependencies: format sniffing, pixel dimensions and the
 * few EXIF tags worth keeping (camera make/model, orientation, original date). Reads only the
 * first bytes, so it is cheap enough to run on the main thread.
 */

/** Image formats we recognise from magic bytes. */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'heic' | 'avif' | 'svg' | 'ico'

export interface ImageInfo {
  format: ImageFormat
  width: number | null
  height: number | null
  exif?: ExifFacts
}

export interface ExifFacts {
  make?: string
  model?: string
  software?: string
  orientation?: number
  /** ISO-8601 from `DateTimeOriginal` / `DateTime`. */
  takenAt?: string
}

/** Sniff the container format from magic bytes (null for non-images). */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null
  const b = bytes
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00))
    return 'tiff'
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12)
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif'
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(brand)) return 'heic'
  }
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico'
  const head = ascii(b, 0, Math.min(b.length, 512)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg'
  return null
}

/** True when the bytes start with `%PDF`. */
export function sniffPdf(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === '%PDF'
}

/** Parse format + dimensions (+ EXIF for JPEG). Returns null when the bytes are not an image. */
export function parseImageInfo(bytes: Uint8Array): ImageInfo | null {
  const format = sniffImageFormat(bytes)
  if (!format) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (format) {
    case 'png':
      if (bytes.length >= 24 && ascii(bytes, 12, 16) === 'IHDR')
        return { format, width: view.getUint32(16), height: view.getUint32(20) }
      return { format, width: null, height: null }
    case 'gif':
      return { format, width: view.getUint16(6, true), height: view.getUint16(8, true) }
    case 'bmp':
      if (bytes.length >= 26)
        return { format, width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
      return { format, width: null, height: null }
    case 'webp':
      return { format, ...webpDims(bytes, view) }
    case 'jpeg':
      return jpegInfo(bytes, view)
    case 'svg':
      return { format, ...svgDims(ascii(bytes, 0, Math.min(bytes.length, 2048))) }
    default:
      return { format, width: null, height: null }
  }
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < end && i < bytes.length; i += 1) s += String.fromCharCode(bytes[i] ?? 0)
  return s
}

function webpDims(bytes: Uint8Array, view: DataView): { width: number | null; height: number | null } {
  const chunk = ascii(bytes, 12, 16)
  if (bytes.length < 30) return { width: null, height: null }
  if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  if (chunk === 'VP8L') {
    const b0 = bytes[21] ?? 0
    const b1 = bytes[22] ?? 0
    const b2 = bytes[23] ?? 0
    const b3 = bytes[24] ?? 0
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
  }
  if (chunk === 'VP8X') {
    const w = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16))
    const h = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16))
    return { width: w, height: h }
  }
  return { width: null, height: null }
}

function svgDims(head: string): { width: number | null; height: number | null } {
  const w = /\swidth=["']?([\d.]+)/.exec(head)?.[1]
  const h = /\sheight=["']?([\d.]+)/.exec(head)?.[1]
  if (w && h) return { width: Math.round(Number(w)), height: Math.round(Number(h)) }
  const vb = /viewBox=["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(head)
  if (vb?.[1] && vb[2]) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) }
  return { width: null, height: null }
}

function jpegInfo(bytes: Uint8Array, view: DataView): ImageInfo {
  let offset = 2
  let width: number | null = null
  let height: number | null = null
  let exif: ExifFacts | undefined
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1] ?? 0
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break
    const length = view.getUint16(offset + 2)
    if (length < 2) break
    const segmentStart = offset + 4
    if (marker === 0xe1 && ascii(bytes, segmentStart, segmentStart + 6) === 'Exif\0\0') {
      exif = parseExif(bytes.subarray(segmentStart + 6, offset + 2 + length)) ?? undefined
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof && width === null) {
      height = view.getUint16(segmentStart + 1)
      width = view.getUint16(segmentStart + 3)
    }
    offset += 2 + length
    if (width !== null && exif !== undefined) break
  }
  const info: ImageInfo = { format: 'jpeg', width, height }
  if (exif) info.exif = exif
  return info
}

const EXIF_TAGS: Record<number, keyof ExifFacts> = {
  271: 'make',
  272: 'model',
  274: 'orientation',
  305: 'software',
  306: 'takenAt',
  36867: 'takenAt'
}

/** Parse a TIFF/EXIF block (after the `Exif\0\0` prefix). */
export function parseExif(tiff: Uint8Array): ExifFacts | null {
  if (tiff.length < 8) return null
  const little = tiff[0] === 0x49 && tiff[1] === 0x49
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const u16 = (o: number): number => (o + 2 <= tiff.length ? view.getUint16(o, little) : 0)
  const u32 = (o: number): number => (o + 4 <= tiff.length ? view.getUint32(o, little) : 0)
  const facts: ExifFacts = {}
  let original: string | undefined
  let fallbackDate: string | undefined

  const readIfd = (start: number, depth: number): void => {
    if (depth > 2 || start + 2 > tiff.length) return
    const count = Math.min(u16(start), 200)
    for (let i = 0; i < count; i += 1) {
      const entry = start + 2 + i * 12
      if (entry + 12 > tiff.length) return
      const tag = u16(entry)
      const type = u16(entry + 2)
      const n = u32(entry + 4)
      const size = (type === 2 || type === 1 || type === 7 ? 1 : type === 3 ? 2 : type === 4 || type === 9 ? 4 : 8) * n
      const valueOffset = size <= 4 ? entry + 8 : u32(entry + 8)
      if (tag === 0x8769) {
        readIfd(u32(entry + 8), depth + 1)
        continue
      }
      const key = EXIF_TAGS[tag]
      if (!key) continue
      if (type === 2) {
        const str = ascii(tiff, valueOffset, Math.min(valueOffset + n, tiff.length))
          .replace(/\0+$/, '')
          .trim()
        if (str.length === 0) continue
        if (tag === 0x9003) original = str
        else if (tag === 0x0132) fallbackDate = str
        else facts[key] = str as never
      } else if (type === 3 && key === 'orientation') {
        facts.orientation = u16(valueOffset)
      }
    }
  }
  readIfd(u32(4), 0)
  const date = exifDateToIso(original ?? fallbackDate)
  if (date) facts.takenAt = date
  return Object.keys(facts).length > 0 ? facts : null
}

/** `YYYY:MM:DD HH:MM:SS` -> ISO-8601 (no timezone information in EXIF; treated as local wall time). */
export function exifDateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value)
  if (!m) return undefined
  const [, y, mo, d, h, mi, s] = m
  if (y === '0000') return undefined
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}
