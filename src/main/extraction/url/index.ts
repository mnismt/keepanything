import type { ExtractedContent, Extractor } from '../types'
import { extractArxiv } from './adapters/arxiv'
import { extractGeneric } from './adapters/generic'
import { extractGithub } from './adapters/github'
import { extractTweet } from './adapters/twitter'
import { extractYoutube } from './adapters/youtube'
import { detectUrlKind } from './detect'

/** URL adapter: routes by `detectUrlKind`, everything else goes through the generic page path. */
export const urlExtractor: Extractor = {
  id: 'url',
  async extract({ item }, deps): Promise<ExtractedContent> {
    if (!item.url) throw new Error('URL item without a url')
    const detected = detectUrlKind(item.url)
    switch (detected.kind) {
      case 'github_repo':
      case 'github_issue':
      case 'github_pr':
      case 'github_other':
        return extractGithub(item, deps, detected)
      case 'arxiv':
        return extractArxiv(item, deps, detected)
      case 'youtube':
        return extractYoutube(item, deps, detected)
      case 'tweet':
        return extractTweet(item, deps, detected)
      case 'pdf':
      case 'generic':
        return extractGeneric(item, deps, detected)
    }
  }
}

export { type DetectedUrl, detectUrlKind, subtypeForUrl, type UrlKind } from './detect'
