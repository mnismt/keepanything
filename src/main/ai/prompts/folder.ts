import { LIMITS } from '../../../shared/constants'
import type { ChatMessage, ChatRequest } from '../../ports'
import { systemMessage, userMessage } from '../messages'
import { COLLECTION_RULES, clipText, IDENTITY, jsonBlock, KIND_RULES, VOICE_RULES } from './voice'

/** Folder structure facts (subset of `FolderMetadata`). */
export interface FolderStructure {
  fileCount: number
  dirCount: number
  totalBytes: number
  truncated?: boolean
  extensions: Record<string, number>
  /** Indented tree listing, already capped. */
  tree?: string
}

export interface FolderSample {
  path: string
  excerpt: string
}

export interface FolderInput {
  title: string
  /** Folder name / relative path shown to the model (never the full absolute path). */
  path?: string
  structure: FolderStructure
  samples: FolderSample[]
  children?: { id?: string; title: string; kind?: string | null; understanding?: string | null }[]
  capturedAt?: string
}

/** Byte-stable system prompt. */
export const FOLDER_SYSTEM_PROMPT = [
  IDENTITY,
  '',
  'Task: understand a folder as a whole from its structure, a sample of its files and what is already known about its children. Say what it is for, which files matter, and whether its children form a collection worth having.',
  '',
  VOICE_RULES,
  '',
  KIND_RULES,
  '',
  'Fields:',
  '- understanding: the same fields as for a single item, describing the folder as one thing (kind is usually other, dataset, design_reference or note; title is the project or purpose, not the directory name).',
  '- purpose: one or two sentences: what this folder seems to be for and what state it is in.',
  '- keyFiles: up to 10 files that matter most, each with a short why (entry points, briefs, final exports, READMEs).',
  '- collection: null unless the children form a meaningful ongoing context that the rules below allow.',
  '',
  COLLECTION_RULES
].join('\n')

export function buildFolderMessages(input: FolderInput): ChatMessage[] {
  const lines: string[] = [`Folder: ${input.title}`]
  if (input.path) lines.push(`Path: ${input.path}`)
  if (input.capturedAt) lines.push(`Captured: ${input.capturedAt}`)
  const { tree, ...structure } = input.structure
  lines.push(jsonBlock('Structure', structure))
  if (tree) lines.push('', 'Tree:', clipText(tree, 6_000))
  if (input.children && input.children.length > 0)
    lines.push('', jsonBlock('Children already understood', input.children.slice(0, 60)))
  if (input.samples.length > 0) {
    lines.push('', 'Sampled files:')
    for (const sample of input.samples.slice(0, LIMITS.folderSampleFiles)) {
      lines.push(`--- ${sample.path}`, clipText(sample.excerpt, 2_000))
    }
  }
  return [systemMessage(FOLDER_SYSTEM_PROMPT), userMessage(lines.join('\n'))]
}

export function buildFolderRequest(input: FolderInput, signal?: AbortSignal): ChatRequest {
  return { messages: buildFolderMessages(input), task: 'folder', signal }
}
