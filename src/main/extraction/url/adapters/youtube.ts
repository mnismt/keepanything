import { LIMITS } from '../../../../shared/constants'
import type { Item } from '../../../../shared/types'
import { capText, EXTRACTION_BUDGET, type ExtractedContent, type ExtractionDeps, squash } from '../../types'
import type { DetectedUrl } from '../detect'
import { fetchJson, fetchPage } from '../fetch'
import { parsePageMetadata } from '../metadata'
import { extractGeneric } from './generic'

interface OEmbed {
  title?: string
  author_name?: string
  author_url?: string
  thumbnail_url?: string
  thumbnail_width?: number
  thumbnail_height?: number
}

/** YouTube: oEmbed for title/author/thumbnail (no key), watch page head for the description. */
export async function extractYoutube(
  item: Item,
  deps: ExtractionDeps,
  detected: DetectedUrl
): Promise<ExtractedContent> {
  const videoId = detected.videoId
  if (!videoId) return extractGeneric(item, deps, detected)
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
  const fetchOpts = {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.signal ? { signal: deps.signal } : {})
  }
  const oembed = await fetchJson<OEmbed>(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    fetchOpts
  )
  if (oembed === null) throw new Error('Could not reach youtube.com')
  if (oembed.status !== 200 || !oembed.json) {
    const fallback = await extractGeneric(item, deps, detected)
    fallback.meta.urlKind = 'youtube'
    fallback.item = { ...fallback.item, subtype: 'youtube' }
    return fallback
  }
  const data = oembed.json
  let description: string | undefined
  let publishedAt: string | undefined
  const page = await fetchPage(watchUrl, { ...fetchOpts, wantBytes: false }).catch(() => null)
  if (page?.html) {
    const head = await parsePageMetadata(page.html, watchUrl)
    description = head.description
    publishedAt = head.publishedAt ?? /"publishDate":"([^"]+)"/.exec(page.html)?.[1]
  }
  const text = capText(
    [data.title ?? '', data.author_name ? `Channel: ${data.author_name}` : '', description ?? '']
      .filter(Boolean)
      .join('\n\n'),
    EXTRACTION_BUDGET.maxChars
  )
  const meta: Record<string, unknown> = {
    video: {
      provider: 'youtube',
      id: videoId,
      author: data.author_name ?? null,
      authorUrl: data.author_url ?? null,
      thumbnail: data.thumbnail_url ?? null
    },
    urlKind: 'youtube',
    siteName: 'YouTube',
    favicon: 'https://www.youtube.com/favicon.ico',
    og: {
      title: data.title,
      description,
      image: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      siteName: 'YouTube',
      type: 'video',
      canonical: watchUrl
    }
  }
  if (data.author_name) meta.byline = data.author_name
  if (description) {
    meta.description = description
    meta.excerpt = squash(description, LIMITS.excerptChars)
  }
  if (publishedAt) {
    const ms = Date.parse(publishedAt)
    if (!Number.isNaN(ms)) meta.publishedAt = new Date(ms).toISOString()
  }
  const out: ExtractedContent = {
    text: text.text,
    meta,
    truncated: text.truncated,
    item: { subtype: 'youtube' }
  }
  if (data.title) out.title = squash(data.title, 200)
  return out
}
