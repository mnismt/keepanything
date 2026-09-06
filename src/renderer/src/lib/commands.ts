/**
 * Multi-item commands (SelectionBar, palette, context menu) -> `agent:command` requests.
 */
import type { AgentCommandRequest } from '../../../shared/ipc'
import type { CommandTemplate } from '../../../shared/types'

export interface SelectionCommand {
  template: CommandTemplate
  /** Short label for the bar. */
  label: string
  /** Full question sent to the agent. */
  question: string
  /** Minimum number of selected items. */
  min: number
  /** Whether the run creates a note item (vs. an inline answer). */
  producesNote: boolean
}

/** The multi-item command vocabulary, in display order. */
export const SELECTION_COMMANDS: readonly SelectionCommand[] = [
  { template: 'compare', label: 'Compare', question: 'Compare these', min: 2, producesNote: false },
  {
    template: 'common',
    label: 'In common',
    question: 'What do these have in common?',
    min: 2,
    producesNote: false
  },
  { template: 'summarize', label: 'Summarize', question: 'Summarize these', min: 1, producesNote: false }
]

/** Commands applicable to a selection of `count` items. */
export function commandsFor(count: number): SelectionCommand[] {
  return SELECTION_COMMANDS.filter((c) => count >= c.min)
}

export function commandByTemplate(template: CommandTemplate): SelectionCommand | undefined {
  return SELECTION_COMMANDS.find((c) => c.template === template)
}

/** Build the `agent:command` payload for a template over item ids (deduplicated, order kept). */
export function buildSelectionCommand(template: CommandTemplate, itemIds: readonly string[]): AgentCommandRequest {
  const ids = [...new Set(itemIds)]
  const command = commandByTemplate(template)
  return { question: command?.question ?? 'Look at these', itemIds: ids, template }
}

/** Build a free-form question over the current selection (palette "Ask about selected"). */
export function buildAskAboutSelection(question: string, itemIds: readonly string[]): AgentCommandRequest {
  const ids = [...new Set(itemIds)]
  return ids.length > 0
    ? { question: question.trim(), itemIds: ids, template: 'custom' }
    : { question: question.trim() }
}

/** Map a native context-menu action id to a command template, or null. */
export function templateFromMenuAction(action: string): CommandTemplate | null {
  switch (action) {
    case 'compare':
    case 'common':
    case 'summarize':
      return action
    default:
      return null
  }
}

/** Prior Q&A a follow-up feeds back as `history`. Only free-form Asks qualify; templates carry their own scope. */
export interface PriorTurn {
  question: string
  answer: string
}

export function buildFollowUp(nextQuestion: string, prior: PriorTurn): AgentCommandRequest {
  return {
    question: nextQuestion.trim(),
    history: [
      { role: 'user', content: prior.question.trim() },
      { role: 'assistant', content: prior.answer.trim() }
    ]
  }
}
