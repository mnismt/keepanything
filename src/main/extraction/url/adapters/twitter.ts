import { LIMITS } from '../../../../shared/constants'
import type { Item } from '../../../../shared/types'
import { capText, EXTRACTION_BUDGET, type ExtractedContent, type ExtractionDeps, squash } from '../../types'
import type { DetectedUrl } from '../detect'
import { fetchJson } from '../fetch'
import { extractGeneric } from './generic'

/** oEmbed answer from publish.twitter.com. */
interface TweetOEmbed {
  html?: string
  author_name?: string
  author_url?: string
  url?: string
}

/** Strip the oEmbed blockquote down to the tweet text. */
export function tweetTextFromHtml(html: string): string {
  const inner = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i.exec(html)?.[1] ?? html
  return inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/\s*—\s*[^—\n]+\(@\w+\)\s*[A-Z][a-z]+ \d{1,2}, \d{4}\s*$/, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** Twitter/X: public oEmbed (no auth) -> text + author. */
export async function extractTweet(item: Item, deps: ExtractionDeps, detected: DetectedUrl): Promise<ExtractedContent> {
  const url = item.url ?? ''
  const response = await fetchJson<TweetOEmbed>(
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`,
    {
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.signal ? { signal: deps.signal } : {})
    }
  )
  if (response === null) throw new Error('Could not reach publish.twitter.com')
  if (response.status !== 200 || !response.json?.html) {
    const fallback = await extractGeneric(item, deps, detected)
    fallback.meta.urlKind = 'tweet'
    fallback.item = { ...fallback.item, subtype: 'tweet' }
    return fallback
  }
  const data = response.json
  const tweet = tweetTextFromHtml(data.html ?? '')
  const author = data.author_name
  const handle = /twitter\.com\/([^/?#]+)/.exec(data.author_url ?? '')?.[1] ?? detected.path.split('/')[1]
  const text = capText(
    [author ? `${author}${handle ? ` (@${handle})` : ''}` : '', tweet].filter(Boolean).join('\n\n'),
    EXTRACTION_BUDGET.maxChars
  )
  const meta: Record<string, unknown> = {
    tweet: { author: author ?? null, handle: handle ?? null, authorUrl: data.author_url ?? null, url: data.url ?? url },
    urlKind: 'tweet',
    siteName: 'X',
    favicon: 'https://abs.twimg.com/favicons/twitter.3.ico',
    og: { title: author ? `${author} on X` : 'Post on X', description: squash(tweet, 500), siteName: 'X' }
  }
  if (author) meta.byline = author
  if (tweet) {
    meta.description = squash(tweet, 500)
    meta.excerpt = squash(tweet, LIMITS.excerptChars)
  }
  const out: ExtractedContent = {
    text: text.text,
    meta,
    truncated: text.truncated,
    item: { subtype: 'tweet' }
  }
  if (tweet) out.title = `${author ?? handle ?? 'Post'}: ${squash(tweet, 80)}`
  if (tweet) out.markdown = `> ${tweet.replace(/\n/g, '\n> ')}\n\n— ${author ?? ''}${handle ? ` (@${handle})` : ''}`
  return out
}
