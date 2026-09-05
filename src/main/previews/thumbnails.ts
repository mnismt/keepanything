import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { nativeImage } from 'electron'
import { writeFileAtomic } from '../lib/fs'
import type { Logger, PreviewSize, Thumbnailer } from '../ports'
import { dominantColor } from './color'

/**
 * Thumbnails: `qlmanage -t` for everything QuickLook understands (PDF, video,
 * HEIC, Office, unknown), `nativeImage` resize for PNG/JPEG/GIF/WebP, no thumbnail otherwise.
 * `createThumbnailFromPath` stretches to the requested box, so it is only used as a last resort
 * for image files whose real size we already know. Also produces the ≤1280 px vision JPEG and the
 * dominant colour. Safe to call concurrently (each qlmanage run gets its own temp dir).
 */

export type { PreviewSize }

/** The full `Thumbnailer` port (thumbnail + vision JPEG + dominant colour). */
export type PreviewMaker = Thumbnailer

/** Options (tests inject a fake `exec`; the app uses the defaults). */
export interface ThumbnailerOptions {
  qlmanagePath?: string
  /** Disable qlmanage (non-macOS). Default: enabled on darwin only. */
  useQuickLook?: boolean
  qlmanageTimeoutMs?: number
}

const NATIVE_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])

/** Longest-side fit. */
export function fitWithin(width: number, height: number, maxPx: number): PreviewSize {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, maxPx / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function createThumbnailer(logger: Logger, opts: ThumbnailerOptions = {}): PreviewMaker {
  const qlmanage = opts.qlmanagePath ?? '/usr/bin/qlmanage'
  const useQuickLook = opts.useQuickLook ?? process.platform === 'darwin'
  const qlTimeout = opts.qlmanageTimeoutMs ?? 20_000

  /** Render with QuickLook into a temp dir; returns the PNG as a nativeImage. */
  const quickLook = async (
    filePath: string,
    maxPx: number,
    signal?: AbortSignal
  ): Promise<Electron.NativeImage | null> => {
    if (!useQuickLook) return null
    const dir = await mkdtemp(join(tmpdir(), 'ka-ql-'))
    try {
      await new Promise<void>((resolve) => {
        const child = execFile(
          qlmanage,
          ['-t', '-s', String(maxPx), '-o', dir, filePath],
          { timeout: qlTimeout, windowsHide: true },
          () => resolve() // non-zero exit = unsupported type; we check for output instead
        )
        signal?.addEventListener('abort', () => child.kill(), { once: true })
      })
      if (signal?.aborted) return null
      const produced = (await readdir(dir)).find((f) => f.endsWith('.png'))
      if (!produced) return null
      const image = nativeImage.createFromPath(join(dir, produced))
      return image.isEmpty() ? null : image
    } catch (error) {
      logger.debug('qlmanage failed', { filePath: basename(filePath), error })
      return null
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Decode an image file with nativeImage (PNG/JPEG/GIF/WebP/BMP/ICO). */
  const decode = (filePath: string): Electron.NativeImage | null => {
    const ext = extname(filePath).slice(1).toLowerCase()
    if (!NATIVE_IMAGE_EXT.has(ext)) return null
    const image = nativeImage.createFromPath(filePath)
    return image.isEmpty() ? null : image
  }

  /** Best source image for a file: native decode, QuickLook, last-resort thumbnail API. */
  const source = async (
    filePath: string,
    maxPx: number,
    signal?: AbortSignal
  ): Promise<Electron.NativeImage | null> => {
    const direct = decode(filePath)
    if (direct) return direct
    const ql = await quickLook(filePath, maxPx, signal)
    if (ql) return ql
    if (signal?.aborted) return null
    const ext = extname(filePath).slice(1).toLowerCase()
    if (NATIVE_IMAGE_EXT.has(ext) || ext === 'heic' || ext === 'heif' || ext === 'tiff' || ext === 'tif') {
      try {
        const thumb = await nativeImage.createThumbnailFromPath(filePath, { width: maxPx, height: maxPx })
        if (!thumb.isEmpty()) return thumb
      } catch (error) {
        logger.debug('createThumbnailFromPath failed', { filePath: basename(filePath), error })
      }
    }
    return null
  }

  const resized = (image: Electron.NativeImage, maxPx: number): Electron.NativeImage => {
    const size = image.getSize()
    if (Math.max(size.width, size.height) <= maxPx) return image
    const target = fitWithin(size.width, size.height, maxPx)
    return image.resize({ ...target, quality: 'good' })
  }

  return {
    async thumbnail(filePath, outPath, maxPx, signal) {
      const image = await source(filePath, maxPx, signal)
      if (!image || signal?.aborted) return null
      const out = resized(image, maxPx)
      await writeFileAtomic(outPath, out.toPNG())
      return out.getSize()
    },
    async visionImage(filePath, outPath, maxPx, signal) {
      const image = await source(filePath, maxPx, signal)
      if (!image || signal?.aborted) return null
      const out = resized(image, maxPx)
      await writeFileAtomic(outPath, out.toJPEG(80))
      return out.getSize()
    },
    async dominantColorOf(imagePath) {
      const image = nativeImage.createFromPath(imagePath)
      if (image.isEmpty()) return null
      const small = image.resize({ width: 32, quality: 'good' })
      const { width, height } = small.getSize()
      return dominantColor(new Uint8Array(small.toBitmap()), width, height, 'bgra')
    }
  }
}
