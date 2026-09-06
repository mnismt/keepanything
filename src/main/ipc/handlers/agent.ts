import { KaError } from '../../core/errors'
import type { AgentService, Retrieval } from '../../ports'
import type { HandlerMap } from '../router'
import type { HandlerDeps } from './deps'

type AgentHandlers = Pick<
  HandlerMap,
  | 'search:quick'
  | 'agent:command'
  | 'agent:cancel'
  | 'agent:run'
  | 'agent:runs'
  | 'agent:undo'
  | 'agent:undoRun'
  | 'agent:applyProposals'
>

/** Search and agent handlers; go through the `Retrieval` / `AgentService` ports. */
export function createAgentHandlers(deps: HandlerDeps): AgentHandlers {
  const retrieval = (): Retrieval => {
    if (!deps.retrieval) throw new KaError('NOT_IMPLEMENTED', "Search isn't available in this build yet.")
    return deps.retrieval
  }
  const agent = (): AgentService => {
    if (!deps.agent) throw new KaError('NOT_IMPLEMENTED', "Ask isn't available in this build yet.")
    return deps.agent
  }
  return {
    'search:quick': ({ query, limit }) => retrieval().quickSearch(query, limit !== undefined ? { limit } : {}),
    'agent:command': (payload) => agent().command(payload, 'user'),
    'agent:cancel': ({ runId }) => {
      agent().cancel(runId)
    },
    'agent:run': ({ id }) => {
      const run = deps.agent?.getRun(id) ?? deps.repos.agentRuns.get(id)
      if (!run) throw new KaError('NOT_FOUND', "Couldn't find that run.")
      return run
    },
    'agent:runs': ({ limit }) => deps.repos.agentRuns.recent(limit ?? 200),
    'agent:undo': ({ auditId }) => {
      // Undo is a core capability: it works with or without the agent slice.
      deps.audit.undo(auditId)
    },
    'agent:undoRun': ({ runId }) => {
      if (!deps.repos.agentRuns.get(runId)) throw new KaError('NOT_FOUND', "Couldn't find that run.")
      return { undone: agent().undoRun(runId) }
    },
    'agent:applyProposals': ({ runId }) => {
      if (!deps.repos.agentRuns.get(runId)) throw new KaError('NOT_FOUND', "Couldn't find that run.")
      return agent().applyProposals(runId)
    }
  }
}
