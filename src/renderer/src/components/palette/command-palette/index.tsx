import Scritto from '@scritto/react'
import * as stylex from '@stylexjs/stylex'
import { Command } from 'cmdk'
import { ArrowLeft, CornerDownLeft, Layers, Plus, Search, Settings, SquareStack } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { COPY } from '../../../../../shared/constants'
import type { AgentCommandRequest } from '../../../../../shared/ipc'
import type { AgentStep, SearchHit } from '../../../../../shared/types'
import { buildAskAboutSelection, buildSelectionCommand, commandsFor } from '../../../lib/commands'
import { count } from '../../../lib/format'
import { describeError, invoke } from '../../../lib/ipc-client'
import { addToCollection } from '../../../lib/library-actions'
import {
  evidenceHeader,
  formatElapsed,
  groupHits,
  hitSnippet,
  noteBodyFor,
  noteTitleFor,
  shouldOfferAsk,
  toolLabel
} from '../../../lib/palette'
import { useCollections } from '../../../state/collections'
import { useLibrary } from '../../../state/library'
import { type RunState, useRuns } from '../../../state/runs'
import { useToasts } from '../../../state/toasts'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Button, Dot, Kbd, ProposalList, Thumb } from '../../common'
import { styles } from './styles'

function Heading({ children }: { children: ReactNode }): React.JSX.Element {
  return <span {...stylex.props(styles.heading)}>{children}</span>
}

/** Seconds since `since`, ticking while `active`. */
function useElapsed(since: number | null, active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [active])
  return since ? Math.max(0, now - since) : 0
}

function StepRow({ step }: { step: AgentStep }): React.JSX.Element {
  return (
    <div {...stylex.props(styles.step)}>
      <span {...stylex.props(styles.stepDot)}>
        <Dot tone={step.status === 'rejected' ? 'neutral' : 'ok'} />
      </span>
      <span {...stylex.props(styles.stepTool)}>{toolLabel(step.tool)}</span>
      <span
        {...stylex.props(styles.stepLabel, step.status === 'rejected' && styles.stepRejected)}
        title={step.rejectReason}
      >
        {step.label}
      </span>
      <span {...stylex.props(styles.stepTime)}>{formatElapsed(step.durationMs)}</span>
    </div>
  )
}

function SourceRow({
  itemId,
  why,
  role,
  onOpen
}: {
  itemId: string
  why: string
  role: 'primary' | 'supporting'
  onOpen: (id: string) => void
}): React.JSX.Element {
  const item = useLibrary((s) => s.byId[itemId])
  return (
    <button type="button" {...stylex.props(shared.hoverFade, styles.source)} onClick={() => onOpen(itemId)}>
      <span {...stylex.props(styles.sourceThumb)}>
        <Thumb src={item?.thumbnailUrl ?? null} fill={item?.dominantColor} />
      </span>
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(shared.ellipsis)}>{item?.title ?? 'An item'}</span>
        <span {...stylex.props(styles.why)}>{why}</span>
      </span>
      {role === 'primary' ? <span {...stylex.props(styles.role)}>Primary</span> : null}
    </button>
  )
}

interface RunViewProps {
  run: RunState | undefined
  question: string
  onOpenItem: (id: string) => void
  onRetry: (() => void) | null
  onBack: () => void
}

function RunView({ run, question, onOpenItem, onRetry, onBack }: RunViewProps): React.JSX.Element {
  const push = useToasts((s) => s.push)
  const byId = useLibrary((s) => s.byId)
  const openDetail = useUi((s) => s.openDetail)
  const closePalette = useUi((s) => s.closePalette)
  const running = run?.status === 'running'
  const lastStepAt = run ? run.startedAt + run.steps.reduce((ms, s) => ms + s.durationMs, 0) : null
  const elapsed = useElapsed(running ? (lastStepAt ?? run?.startedAt ?? null) : null, running)
  const [saving, setSaving] = useState(false)
  const answer = run?.result && run.result.task === 'command' ? run.result : null

  const saveAsNote = async (): Promise<void> => {
    if (!answer?.answer) return
    setSaving(true)
    const sources = answer.sources.map((s) => ({ title: byId[s.itemId]?.title ?? 'An item' }))
    const r = await invoke('capture:text', {
      text: noteBodyFor(question, answer.answer, sources),
      title: noteTitleFor(question)
    })
    setSaving(false)
    if (!r.ok) {
      push({ text: describeError(r.error) })
      return
    }
    const id = r.data.items[0]?.id
    push({
      text: 'Saved as a note.',
      action: id
        ? {
            label: 'Show',
            run: () => {
              closePalette()
              openDetail(id, id)
            }
          }
        : undefined
    })
  }

  return (
    <>
      <div {...stylex.props(styles.run)} role="status" aria-live="polite" aria-label="Ask">
        {question ? <p {...stylex.props(styles.question, shared.selectable)}>{question}</p> : null}
        {run && (running || !answer) && run.steps.length > 0 ? (
          <div {...stylex.props(styles.steps)}>
            {run.steps.map((s) => (
              <StepRow key={s.n} step={s} />
            ))}
          </div>
        ) : null}
        {running ? (
          <div {...stylex.props(styles.step)}>
            <span {...stylex.props(styles.stepDot)}>
              <Dot tone="processing" />
            </span>
            <span {...stylex.props(styles.stepTool)} />
            <span {...stylex.props(styles.stepLabel)}>
              {run && run.steps.length === 0 ? 'Looking through your library' : 'Thinking it over'}
            </span>
            <Scritto {...stylex.props(styles.stepTime)} value={formatElapsed(elapsed)} trend={1} />
          </div>
        ) : null}
        {run?.status === 'failed' ? (
          <p {...stylex.props(styles.error)}>{run.error ? describeError(run.error) : 'That did not work.'}</p>
        ) : null}
        {run?.status === 'cancelled' ? <p {...stylex.props(styles.error)}>Stopped.</p> : null}
        {answer ? (
          <>
            {run ? (
              <p {...stylex.props(styles.evidence)}>{evidenceHeader(run.steps, answer.cues) || 'From your library'}</p>
            ) : null}
            {answer.kind === 'note' && answer.noteId ? (
              <button
                type="button"
                {...stylex.props(styles.noteCard)}
                onClick={() => answer.noteId && onOpenItem(answer.noteId)}
              >
                <span {...stylex.props(styles.noteTitle, shared.ellipsis)}>
                  {byId[answer.noteId]?.title ?? 'New note'}
                </span>
                <span {...stylex.props(styles.why)}>Open</span>
              </button>
            ) : (
              <p {...stylex.props(styles.answer, shared.selectable)}>{answer.answer ?? COPY.askNothing}</p>
            )}
            {answer.sources.length > 0 ? (
              <div {...stylex.props(styles.sources)}>
                {answer.sources.map((s) => (
                  <SourceRow key={s.itemId} itemId={s.itemId} why={s.why} role={s.role} onOpen={onOpenItem} />
                ))}
              </div>
            ) : null}
            {run ? (
              <ProposalList
                runId={run.runId}
                proposals={answer.proposals ?? []}
                appliedCount={answer.appliedCount ?? 0}
                undoable={run.undoable}
              />
            ) : null}
          </>
        ) : null}
      </div>
      <div {...stylex.props(styles.footer)}>
        <Button small variant="quiet" onClick={onBack} aria-label="Back to search">
          <ArrowLeft size={14} strokeWidth={1.5} />
          Back
        </Button>
        <span {...stylex.props(styles.footerSpacer)} />
        {running && run ? (
          <Button small variant="quiet" onClick={() => void invoke('agent:cancel', { runId: run.runId })}>
            Cancel
          </Button>
        ) : (
          <>
            {onRetry ? (
              <Button small variant="quiet" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
            {answer?.kind === 'answer' && answer.answer ? (
              <Button small onClick={() => void saveAsNote()} disabled={saving}>
                {saving ? 'Saving…' : 'Save as note'}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

/**
 * CommandPalette (⌘K): instant local hits grouped by type, an "Ask" row for natural language,
 * multi-item commands over the current selection, and the run view (steps -> answer with sources).
 */
export function CommandPalette(): React.JSX.Element {
  const closePalette = useUi((s) => s.closePalette)
  const openDetail = useUi((s) => s.openDetail)
  const openSettings = useUi((s) => s.openSettings)
  const pushModal = useUi((s) => s.push)
  const initialQuery = useUi((s) => s.paletteQuery)
  const initialRunId = useUi((s) => s.paletteRunId)
  const recent = useLibrary(
    useShallow((s) =>
      s.order
        .slice(0, 5)
        .map((id) => s.byId[id])
        .filter((i): i is NonNullable<typeof i> => i !== undefined)
    )
  )
  const selection = useLibrary((s) => s.selection)
  const collections = useCollections((s) => s.list)
  const push = useToasts((s) => s.push)
  const [query, setQuery] = useState(initialRunId ? '' : initialQuery)
  const [question, setQuestion] = useState(initialRunId ? initialQuery : '')
  const [active, setActive] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [runId, setRunId] = useState<string | null>(initialRunId)
  const [lastRequest, setLastRequest] = useState<AgentCommandRequest | null>(null)
  const [mode, setMode] = useState<'search' | 'addToCollection'>('search')
  const [askError, setAskError] = useState<string | null>(null)
  const run = useRuns((s) => (runId ? s.runs[runId] : undefined))
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const openedIntoRun = useRef(Boolean(initialRunId))
  const selected = useMemo(() => [...selection], [selection])

  useEffect(() => {
    if (!runId) inputRef.current?.focus()
  }, [runId, mode])

  useEffect(() => {
    const q = query.trim()
    if (!q || mode !== 'search') {
      setHits([])
      return
    }
    const mine = ++seq.current
    const t = setTimeout(() => {
      void invoke('search:quick', { query: q, limit: 8 }).then((r) => {
        if (mine !== seq.current) return
        setHits(r.ok ? r.data : [])
      })
    }, 50)
    return () => clearTimeout(t)
  }, [query, mode])

  const groups = useMemo(() => groupHits(hits), [hits])
  const showAsk = shouldOfferAsk(query, hits.length)
  const trimmed = query.trim()

  const start = async (request: AgentCommandRequest): Promise<void> => {
    setAskError(null)
    setLastRequest(request)
    setQuestion(request.question)
    const result = await invoke('agent:command', request)
    if (result.ok) setRunId(result.data.runId)
    else setAskError(describeError(result.error))
  }

  const open = (id: string): void => {
    closePalette()
    openDetail(id, id)
  }

  const back = (): void => {
    if (run && run.status === 'running') void invoke('agent:cancel', { runId: run.runId })
    if (openedIntoRun.current) {
      closePalette()
      return
    }
    setRunId(null)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (runId) {
      back()
      return
    }
    if (mode === 'addToCollection') {
      setMode('search')
      setQuery('')
      return
    }
    closePalette()
  }

  const addSelectedTo = async (collectionId: string): Promise<void> => {
    const ok = await addToCollection(collectionId, selected)
    if (ok) closePalette()
  }

  const createAndAdd = async (): Promise<void> => {
    const r = await useCollections.getState().create(trimmed)
    if (!r.ok) {
      push({ text: describeError(r.error) })
      return
    }
    await addSelectedTo(r.data.id)
  }

  const itemProps = (value: string): ReturnType<typeof stylex.props> =>
    stylex.props(styles.item, active === value && styles.itemActive)
  const filteredCollections =
    mode === 'addToCollection'
      ? collections.filter((c) => !trimmed || c.name.toLowerCase().includes(trimmed.toLowerCase()))
      : []
  const commands = commandsFor(selected.length)

  return (
    <div
      {...stylex.props(styles.scrim)}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && closePalette()}
    >
      <Command
        {...stylex.props(styles.dialog)}
        label="Search anything"
        shouldFilter={false}
        onKeyDown={onKeyDown}
        loop
        value={active}
        onValueChange={setActive}
      >
        {runId ? (
          <RunView
            run={run}
            question={question}
            onOpenItem={open}
            onRetry={lastRequest ? () => void start(lastRequest) : null}
            onBack={back}
          />
        ) : (
          <>
            <div {...stylex.props(styles.inputRow)}>
              {mode === 'addToCollection' ? (
                <span {...stylex.props(styles.modeChip)}>
                  <Layers size={12} strokeWidth={1.5} />
                  Add {count(selected.length, 'item')} to
                </span>
              ) : (
                <Search size={16} strokeWidth={1.5} />
              )}
              <Command.Input
                ref={inputRef}
                {...stylex.props(styles.input)}
                value={query}
                onValueChange={setQuery}
                placeholder={mode === 'addToCollection' ? 'Find or create a collection…' : 'Search anything, or ask…'}
              />
              {mode === 'search' && !trimmed ? <Kbd>esc</Kbd> : null}
            </div>
            <Command.List {...stylex.props(styles.list)}>
              {askError ? <p {...stylex.props(styles.empty)}>{askError}</p> : null}

              {mode === 'addToCollection' ? (
                <Command.Group heading={<Heading>Collections</Heading>}>
                  {filteredCollections.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`col-${c.id}`}
                      {...itemProps(`col-${c.id}`)}
                      onSelect={() => void addSelectedTo(c.id)}
                    >
                      <span {...stylex.props(styles.iconCell)}>
                        <Layers size={14} strokeWidth={1.5} />
                      </span>
                      <span {...stylex.props(styles.text)}>
                        <span {...stylex.props(shared.ellipsis)}>{c.name}</span>
                        {c.description ? (
                          <span {...stylex.props(styles.sub, shared.ellipsis)}>{c.description}</span>
                        ) : null}
                      </span>
                      <span {...stylex.props(styles.meta)}>{count(c.count, 'item')}</span>
                    </Command.Item>
                  ))}
                  {trimmed && !collections.some((c) => c.name.toLowerCase() === trimmed.toLowerCase()) ? (
                    <Command.Item value="col-new" {...itemProps('col-new')} onSelect={() => void createAndAdd()}>
                      <span {...stylex.props(styles.iconCell)}>
                        <Plus size={14} strokeWidth={1.5} />
                      </span>
                      <span {...stylex.props(shared.ellipsis)}>Create “{trimmed}”</span>
                      <span {...stylex.props(styles.meta)}>New collection</span>
                    </Command.Item>
                  ) : null}
                  {filteredCollections.length === 0 && !trimmed ? (
                    <p {...stylex.props(styles.empty)}>No collections yet. Type a name to create one.</p>
                  ) : null}
                </Command.Group>
              ) : trimmed.length === 0 ? (
                <>
                  {selected.length > 0 ? (
                    <Command.Group heading={<Heading>{count(selected.length, 'item')} selected</Heading>}>
                      {commands.map((c) => (
                        <Command.Item
                          key={c.template}
                          value={`sel-${c.template}`}
                          {...itemProps(`sel-${c.template}`)}
                          onSelect={() => void start(buildSelectionCommand(c.template, selected))}
                        >
                          <span {...stylex.props(styles.iconCell)}>
                            <SquareStack size={14} strokeWidth={1.5} />
                          </span>
                          <span {...stylex.props(shared.ellipsis)}>{c.label} selected</span>
                          <span {...stylex.props(styles.meta)}>{c.producesNote ? 'Makes a note' : 'Answer'}</span>
                        </Command.Item>
                      ))}
                      <Command.Item
                        value="sel-add"
                        {...itemProps('sel-add')}
                        onSelect={() => setMode('addToCollection')}
                      >
                        <span {...stylex.props(styles.iconCell)}>
                          <Layers size={14} strokeWidth={1.5} />
                        </span>
                        <span {...stylex.props(shared.ellipsis)}>Add to collection…</span>
                      </Command.Item>
                    </Command.Group>
                  ) : null}
                  {recent.length > 0 ? (
                    <Command.Group heading={<Heading>Recent</Heading>}>
                      {recent.map((i) => (
                        <Command.Item
                          key={i.id}
                          value={`recent-${i.id}`}
                          {...itemProps(`recent-${i.id}`)}
                          onSelect={() => open(i.id)}
                        >
                          <span {...stylex.props(styles.thumb)}>
                            <Thumb src={i.thumbnailUrl} fill={i.dominantColor} />
                          </span>
                          <span {...stylex.props(styles.text)}>
                            <span {...stylex.props(shared.ellipsis)}>{i.title}</span>
                            {i.understanding ? (
                              <span {...stylex.props(styles.sub, shared.ellipsis)}>{i.understanding}</span>
                            ) : null}
                          </span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  <Command.Group heading={<Heading>Try asking</Heading>}>
                    {[
                      'What am I researching here?',
                      'What did I save this week?',
                      'Find that mac app I saved recently'
                    ].map((q) => (
                      <Command.Item
                        key={q}
                        value={`suggest-${q}`}
                        {...itemProps(`suggest-${q}`)}
                        onSelect={() => setQuery(q)}
                      >
                        <span {...stylex.props(styles.iconCell)}>
                          <CornerDownLeft size={14} strokeWidth={1.5} />
                        </span>
                        <span {...stylex.props(shared.ellipsis)}>{q}</span>
                      </Command.Item>
                    ))}
                    <Command.Item
                      value="suggest-settings"
                      {...itemProps('suggest-settings')}
                      onSelect={() => {
                        closePalette()
                        openSettings()
                      }}
                    >
                      <span {...stylex.props(styles.iconCell)}>
                        <Settings size={14} strokeWidth={1.5} />
                      </span>
                      <span {...stylex.props(shared.ellipsis)}>Settings</span>
                      <span {...stylex.props(styles.meta)}>⌘,</span>
                    </Command.Item>
                  </Command.Group>
                </>
              ) : (
                <>
                  {groups.map((g) => (
                    <Command.Group key={g.id} heading={<Heading>{g.label}</Heading>}>
                      {g.hits.map((h) => (
                        <Command.Item
                          key={h.id}
                          value={`hit-${h.id}`}
                          {...itemProps(`hit-${h.id}`)}
                          onSelect={() => open(h.id)}
                        >
                          <span {...stylex.props(styles.thumb)}>
                            <Thumb src={h.thumbnailUrl ?? null} />
                          </span>
                          <span {...stylex.props(styles.text)}>
                            <span {...stylex.props(shared.ellipsis)}>{h.title}</span>
                            <span {...stylex.props(styles.sub, shared.ellipsis)}>{hitSnippet(h)}</span>
                          </span>
                          <span {...stylex.props(styles.meta)}>{h.capturedAgo}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))}
                  {hits.length === 0 ? <p {...stylex.props(styles.empty)}>{COPY.noMatches(trimmed)}</p> : null}
                  {showAsk || selected.length > 0 ? (
                    <Command.Group heading={<Heading>Ask</Heading>}>
                      {showAsk ? (
                        <Command.Item
                          value="ask"
                          {...itemProps('ask')}
                          onSelect={() => void start({ question: trimmed })}
                        >
                          <span {...stylex.props(styles.iconCell)}>
                            <CornerDownLeft size={14} strokeWidth={1.5} />
                          </span>
                          <span {...stylex.props(shared.ellipsis)}>Ask: {trimmed}</span>
                          <span {...stylex.props(styles.meta)}>Looks through your library</span>
                        </Command.Item>
                      ) : null}
                      {selected.length > 0 ? (
                        <Command.Item
                          value="ask-selected"
                          {...itemProps('ask-selected')}
                          onSelect={() => void start(buildAskAboutSelection(trimmed, selected))}
                        >
                          <span {...stylex.props(styles.iconCell)}>
                            <SquareStack size={14} strokeWidth={1.5} />
                          </span>
                          <span {...stylex.props(shared.ellipsis)}>
                            Ask about the {count(selected.length, 'selected item')}: {trimmed}
                          </span>
                        </Command.Item>
                      ) : null}
                    </Command.Group>
                  ) : null}
                </>
              )}
            </Command.List>
            {mode === 'search' ? (
              <div {...stylex.props(styles.footer)}>
                <span>
                  <Kbd>↑↓</Kbd> move · <Kbd>↩</Kbd> open
                </span>
                <span {...stylex.props(styles.footerSpacer)} />
                <button
                  type="button"
                  {...stylex.props(styles.meta)}
                  onClick={() => {
                    closePalette()
                    pushModal({ kind: 'dialog', id: 'newCollection' })
                  }}
                >
                  New collection
                </button>
              </div>
            ) : null}
          </>
        )}
      </Command>
    </div>
  )
}
