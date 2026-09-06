import type { AgentCommandTurn } from '../../../shared/ipc'
import { truncate } from '../../../shared/text'
import type { CommandTemplate } from '../../../shared/types'
import type { ChatMessage } from '../../ports'
import { assistantMessage, systemMessage, userMessage } from '../messages'
import { IDENTITY, jsonBlock, VOICE_RULES } from './voice'

export interface CommandSeed {
  id: string
  title: string
  type: string
  kind?: string | null
  understanding?: string | null
  capturedAgo?: string
}

/** Per-turn char cap so a stray long prior answer can't blow the prompt budget. */
const HISTORY_TURN_CHARS = 2_000

export type CommandInput =
  | { mode: 'ask'; question: string; today?: string; history?: AgentCommandTurn[] }
  | { mode: 'template'; template: CommandTemplate; seeds: CommandSeed[]; instruction?: string; today?: string }

/** Byte-stable system prompt. Dates never go here (see `today` in the user message). */
export const COMMAND_SYSTEM_PROMPT = [
  IDENTITY,
  '',
  'Task: answer a question about the library, carry out a multi-item request, or perform an action on an item, using the tools. Everything you claim must come from items you inspected or read in this run.',
  '',
  'How to work:',
  '1. Read the request. Extract memory cues: topics, likely item types, a time frame ("a few weeks ago" → the last 6 weeks), names.',
  '2. Retrieve: search_library / semantic_search with the cues (try two phrasings if the first returns nothing); list_items or topic_overview for questions about the library as a whole ("what am I researching?").',
  '3. Inspect the best 3–5 candidates with inspect_item / read_document before answering. Do not answer from titles alone.',
  '4. Finish with the finish tool: kind "answer" for an inline answer, kind "note" when the request asks for a document (comparison, extracted claims).',
  '',
  'Answer rules:',
  VOICE_RULES,
  'Cite sources with [n] markers that map to the sources list in order; every claim in the answer traces to a source. Sources have role primary (the thing asked about) or supporting.',
  'If nothing relevant was found, finish with an empty sources list and a one-line answer saying so; do not guess.',
  'Notes are Markdown with a short title, sections when useful, and [n] markers. Do not repeat the sources list inside the note body.',
  'cues: report the topics, types and time frame you searched with, so the person sees how you looked.'
].join('\n')

const TEMPLATE_INSTRUCTIONS: Record<CommandTemplate, string> = {
  compare: 'Compare these items: what each is, how they differ, when to pick which. Finish with kind "note".',
  common: 'Work out what these items have in common and what the shared context might be. Finish with kind "answer".',
  summarize: 'Summarize this research: the question it circles, what was found, open threads. Finish with kind "note".',
  extract: 'Extract the concrete claims, figures and decisions from these items. Finish with kind "note".',
  custom: 'Follow the instruction below using these items as the material.'
}

/** Messages for a command run (system + the request; tool results are appended by the agent). */
export function buildCommandMessages(input: CommandInput): ChatMessage[] {
  const messages: ChatMessage[] = [systemMessage(COMMAND_SYSTEM_PROMPT)]
  if (input.mode === 'ask') {
    for (const turn of input.history ?? []) {
      const content = truncate(turn.content.trim(), HISTORY_TURN_CHARS)
      if (content) messages.push(turn.role === 'assistant' ? assistantMessage(content) : userMessage(content))
    }
  }
  const lines: string[] = []
  if (input.today) lines.push(`Today: ${input.today}`)
  switch (input.mode) {
    case 'ask':
      lines.push(`Question: ${input.question.trim()}`)
      break
    case 'template':
      lines.push(TEMPLATE_INSTRUCTIONS[input.template])
      if (input.instruction) lines.push(`Instruction: ${input.instruction.trim()}`)
      lines.push('', jsonBlock('Selected items', input.seeds), '', 'Read every selected item before writing.')
      break
  }
  messages.push(userMessage(lines.join('\n')))
  return messages
}

/** The message that forces the last step (verified alternative to named tool_choice). */
export const FORCE_FINISH_MESSAGE = 'You have enough information. Call finish now.'

/** Appended when the model answered in prose without calling a tool. */
export const NO_TOOL_CALL_MESSAGE =
  'Use the finish tool to deliver your answer; plain text is not delivered to the person.'
