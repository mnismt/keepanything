/**
 * Dominant colour of a bitmap for card placeholders. Pure (no Electron): the caller hands over
 * raw pixels (RGBA or BGRA) from `nativeImage.toBitmap()` on a small resized copy.
 */

/** Pixel byte order. `nativeImage.toBitmap()` is BGRA on macOS. */
export type PixelOrder = 'rgba' | 'bgra'

/** `#rrggbb` from channels. */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/**
 * Most populous colour bucket (4 bits per channel), averaged back to a real colour. Transparent
 * pixels are ignored; near-white/near-black buckets lose to a saturated bucket that holds at
 * least a fifth as many pixels, so placeholders carry the image's hue rather than its paper.
 */
export function dominantColor(
  pixels: Uint8Array,
  width: number,
  height: number,
  order: PixelOrder = 'rgba'
): string | null {
  const total = width * height
  if (total === 0 || pixels.length < total * 4) return null
  const step = Math.max(1, Math.floor(total / 4096))
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < total; i += step) {
    const o = i * 4
    const a = pixels[o + 3] ?? 255
    if (a < 128) continue
    const r = (order === 'rgba' ? pixels[o] : pixels[o + 2]) ?? 0
    const g = pixels[o + 1] ?? 0
    const b = (order === 'rgba' ? pixels[o + 2] : pixels[o]) ?? 0
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.n += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else buckets.set(key, { n: 1, r, g, b })
  }
  if (buckets.size === 0) return null
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n)
  const top = ranked[0] as { n: number; r: number; g: number; b: number }
  const avg = (bk: typeof top): [number, number, number] => [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n]
  const isPaper = ([r, g, b]: [number, number, number]): boolean => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return max - min < 24 && (max > 225 || max < 30)
  }
  let chosen = top
  if (isPaper(avg(top))) {
    const alternative = ranked.find((bk) => bk.n >= top.n / 5 && !isPaper(avg(bk)))
    if (alternative) chosen = alternative
  }
  const [r, g, b] = avg(chosen)
  return rgbToHex(r, g, b)
}
