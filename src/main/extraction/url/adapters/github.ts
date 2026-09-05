import { LIMITS } from '../../../../shared/constants'
import type { Item, RepoMetadata } from '../../../../shared/types'
import { markdownToText } from '../../text'
import { capText, EXTRACTION_BUDGET, type ExtractedContent, type ExtractionDeps, squash } from '../../types'
import type { DetectedUrl } from '../detect'
import { fetchJson, fetchText } from '../fetch'
import { extractGeneric } from './generic'

/**
 * GitHub via the public REST API (no token; 60 req/h per IP). Repos: facts + README head.
 * Issues/PRs: title, body, state, labels. Rate limits or API errors fall back to the HTML page.
 */

const API = 'https://api.github.com'
const API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }

interface RepoResponse {
  full_name?: string
  description?: string | null
  language?: string | null
  stargazers_count?: number
  forks_count?: number
  topics?: string[]
  default_branch?: string
  homepage?: string | null
  license?: { spdx_id?: string; name?: string } | null
  pushed_at?: string
  archived?: boolean
  fork?: boolean
  open_issues_count?: number
  owner?: { login?: string; avatar_url?: string }
}

interface IssueResponse {
  number?: number
  title?: string
  body?: string | null
  state?: string
  labels?: { name?: string }[]
  user?: { login?: string }
  comments?: number
  created_at?: string
  updated_at?: string
  closed_at?: string | null
  pull_request?: { merged_at?: string | null }
  merged?: boolean
  draft?: boolean
}

const opts = (deps: ExtractionDeps) => ({
  ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  ...(deps.signal ? { signal: deps.signal } : {}),
  headers: API_HEADERS
})

export function repoMetadataFrom(repo: RepoResponse, owner: string, name: string): RepoMetadata {
  const out: RepoMetadata = { owner, name }
  if (repo.description !== undefined) out.description = repo.description
  if (repo.language !== undefined) out.language = repo.language
  if (typeof repo.stargazers_count === 'number') out.stars = repo.stargazers_count
  if (typeof repo.forks_count === 'number') out.forks = repo.forks_count
  if (repo.topics) out.topics = repo.topics.slice(0, 20)
  if (repo.default_branch) out.defaultBranch = repo.default_branch
  if (repo.homepage !== undefined) out.homepage = repo.homepage
  if (repo.license !== undefined) out.license = repo.license?.spdx_id ?? repo.license?.name ?? null
  if (repo.pushed_at) out.pushedAt = repo.pushed_at
  return out
}

export async function extractGithub(
  item: Item,
  deps: ExtractionDeps,
  detected: DetectedUrl
): Promise<ExtractedContent> {
  const { owner, repo } = detected
  if (!owner || !repo || detected.kind === 'github_other') return extractGeneric(item, deps, detected)
  if (detected.kind === 'github_repo') return extractRepo(item, deps, detected, owner, repo)
  return extractIssue(item, deps, detected, owner, repo)
}

async function extractRepo(
  item: Item,
  deps: ExtractionDeps,
  detected: DetectedUrl,
  owner: string,
  repo: string
): Promise<ExtractedContent> {
  const response = await fetchJson<RepoResponse>(`${API}/repos/${owner}/${repo}`, opts(deps))
  if (response === null) throw new Error('Could not reach api.github.com')
  if (response.status !== 200 || !response.json) {
    deps.logger.debug('github api unavailable; using the page', { status: response.status })
    const fallback = await extractGeneric(item, deps, detected)
    fallback.meta.urlKind = 'github_repo'
    fallback.meta.githubApiStatus = response.status
    fallback.item = { ...fallback.item, subtype: 'github_repo' }
    return fallback
  }
  const data = response.json
  const facts = repoMetadataFrom(data, owner, repo)
  let readme = ''
  const readmeResponse = await fetchText(`${API}/repos/${owner}/${repo}/readme`, {
    ...opts(deps),
    headers: { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' }
  })
  if (readmeResponse?.status === 200) readme = readmeResponse.text.slice(0, EXTRACTION_BUDGET.githubReadmeChars)
  const readmeTruncated = (readmeResponse?.text.length ?? 0) > EXTRACTION_BUDGET.githubReadmeChars

  const lines = [
    `${owner}/${repo}`,
    facts.description ?? '',
    facts.language ? `Language: ${facts.language}` : '',
    facts.topics && facts.topics.length > 0 ? `Topics: ${facts.topics.join(', ')}` : '',
    typeof facts.stars === 'number' ? `Stars: ${facts.stars}` : '',
    facts.homepage ? `Homepage: ${facts.homepage}` : ''
  ].filter((l) => l.length > 0)
  const text = capText(
    [lines.join('\n'), markdownToText(readme)].filter(Boolean).join('\n\n'),
    EXTRACTION_BUDGET.maxChars
  )
  const meta: Record<string, unknown> = {
    repo: facts,
    urlKind: 'github_repo',
    siteName: 'GitHub',
    favicon: 'https://github.com/favicon.ico',
    og: {
      title: data.full_name ?? `${owner}/${repo}`,
      description: facts.description ?? undefined,
      image: data.owner?.avatar_url,
      siteName: 'GitHub'
    },
    readmeChars: readme.length,
    readmeTruncated
  }
  if (facts.description) meta.description = facts.description
  if (facts.pushedAt) meta.updatedAt = facts.pushedAt
  const excerpt = squash(facts.description ?? markdownToText(readme), LIMITS.excerptChars)
  if (excerpt) meta.excerpt = excerpt
  const out: ExtractedContent = {
    text: text.text,
    meta,
    truncated: text.truncated || readmeTruncated,
    title: data.full_name ?? `${owner}/${repo}`,
    item: { subtype: 'github_repo' }
  }
  if (readme.length > 0) out.markdown = readme
  return out
}

async function extractIssue(
  item: Item,
  deps: ExtractionDeps,
  detected: DetectedUrl,
  owner: string,
  repo: string
): Promise<ExtractedContent> {
  const number = detected.number ?? 0
  const response = await fetchJson<IssueResponse>(`${API}/repos/${owner}/${repo}/issues/${number}`, opts(deps))
  if (response === null) throw new Error('Could not reach api.github.com')
  if (response.status !== 200 || !response.json) {
    const fallback = await extractGeneric(item, deps, detected)
    fallback.meta.urlKind = detected.kind
    fallback.meta.githubApiStatus = response.status
    return fallback
  }
  const data = response.json
  const isPr = detected.kind === 'github_pr' || Boolean(data.pull_request)
  const labels = (data.labels ?? []).map((l) => l.name).filter((n): n is string => Boolean(n))
  const state = isPr && (data.merged || data.pull_request?.merged_at) ? 'merged' : (data.state ?? 'open')
  const body = (data.body ?? '').replace(/\r\n/g, '\n').trim()
  const header = [
    `${isPr ? 'Pull request' : 'Issue'} #${number} · ${owner}/${repo}`,
    data.title ?? '',
    `State: ${state}${data.draft ? ' (draft)' : ''}`,
    data.user?.login ? `Author: ${data.user.login}` : '',
    labels.length > 0 ? `Labels: ${labels.join(', ')}` : ''
  ]
    .filter((l) => l.length > 0)
    .join('\n')
  const text = capText(`${header}\n\n${markdownToText(body)}`, EXTRACTION_BUDGET.maxChars)
  const meta: Record<string, unknown> = {
    issue: {
      owner,
      repo,
      number,
      kind: isPr ? 'pr' : 'issue',
      state,
      labels,
      author: data.user?.login ?? null,
      comments: data.comments ?? 0,
      createdAt: data.created_at ?? null,
      closedAt: data.closed_at ?? null
    },
    urlKind: isPr ? 'github_pr' : 'github_issue',
    siteName: 'GitHub',
    favicon: 'https://github.com/favicon.ico',
    og: { title: data.title, siteName: 'GitHub' }
  }
  const excerpt = squash(markdownToText(body), LIMITS.excerptChars)
  if (excerpt) meta.excerpt = excerpt
  if (data.created_at) meta.publishedAt = data.created_at
  const out: ExtractedContent = {
    text: text.text,
    meta,
    truncated: text.truncated,
    title: `${data.title ?? `#${number}`} · ${owner}/${repo}#${number}`,
    item: { subtype: 'generic' }
  }
  if (body.length > 0) out.markdown = `# ${data.title ?? `#${number}`}\n\n${body}`
  return out
}
