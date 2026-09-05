import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ImageSubtype } from '../../shared/types'
import { type ExifFacts, type ImageInfo, parseImageInfo } from './image-dims'
import type { ExtractedContent, Extractor } from './types'

/**
 * Images: dimensions and EXIF from the header bytes, plus the screenshot/photo/design heuristic.
 * The ≤1280 px vision JPEG for the understand task is produced by `previews/` (needs nativeImage);
 * this module stays pure.
 */

const HEADER_BYTES = 256 * 1024

const SCREENSHOT_NAME =
  /(^|[\s_-])(screenshot|screen shot|screen[- ]?capture|cleanshot|bildschirmfoto|capture d.[ée]cran|captura de pantalla|schermafbeelding|sk[äa]rmavbild|skjermbilde|zrzut ekranu|스크린샷|截屏|截图|スクリーンショット|simulator screen shot|scr-\d{8})/i

/** True for file names produced by macOS/iOS/CleanShot/Windows screenshot tools. */
export function isScreenshotName(name: string): boolean {
  return SCREENSHOT_NAME.test(basename(name))
}

/** Common display aspect ratios (w/h) screenshots tend to have, with tolerance. */
const DISPLAY_RATIOS = [16 / 10, 16 / 9, 4 / 3, 3 / 2, 21 / 9, 1.6, 2.165, 0.46, 0.5625, 0.625]

export function classifyImage(
  name: string,
  info: Pick<ImageInfo, 'format' | 'width' | 'height'> & { exif?: ExifFacts }
): ImageSubtype {
  if (isScreenshotName(name)) return 'screenshot'
  if (info.format === 'svg') return 'design'
  const camera = Boolean(info.exif?.make || info.exif?.model)
  if (camera) return 'photo'
  const { width, height } = info
  if (width && height && width >= 600 && height >= 400) {
    const ratio = width / height
    const displayLike = DISPLAY_RATIOS.some((r) => Math.abs(ratio - r) < 0.02)
    if (info.format === 'png' && displayLike) return 'screenshot'
    if (info.format === 'jpeg' && Math.max(width, height) >= 1600 && !displayLike) return 'photo'
  }
  if (info.format === 'jpeg' || info.format === 'heic') return 'photo'
  return 'generic'
}

export async function readHeader(filePath: string, bytes = HEADER_BYTES): Promise<Uint8Array> {
  const handle = await open(filePath, 'r')
  try {
    const stats = await handle.stat()
    const size = Math.min(stats.size, bytes)
    const buffer = new Uint8Array(size)
    let read = 0
    while (read < size) {
      const result = await handle.read(buffer, read, size - read, read)
      if (result.bytesRead === 0) break
      read += result.bytesRead
    }
    return buffer.subarray(0, read)
  } finally {
    await handle.close()
  }
}

export async function inspectImage(
  filePath: string,
  name = basename(filePath)
): Promise<{ info: ImageInfo | null; subtype: ImageSubtype }> {
  const header = await readHeader(filePath)
  const info = parseImageInfo(header)
  const subtype = info ? classifyImage(name, info) : isScreenshotName(name) ? 'screenshot' : 'generic'
  return { info, subtype }
}

/** Image adapter (dims + EXIF + subtype). Text stays empty; vision fills it later. */
export const imageExtractor: Extractor = {
  id: 'image',
  async extract({ item, filePath }) {
    if (!filePath) throw new Error('No image file to read')
    const name = item.metadata.originalName ?? basename(filePath)
    const { info, subtype } = await inspectImage(filePath, name)
    const meta: Record<string, unknown> = { image: { format: info?.format ?? null } }
    if (info?.exif) meta.exif = info.exif
    const out: ExtractedContent = {
      text: '',
      meta,
      truncated: false,
      item: { subtype }
    }
    if (info?.width && info.height) out.dims = { width: info.width, height: info.height }
    if (!info) {
      out.partial = true
      out.error = 'Unrecognised image header'
    }
    return out
  }
}
