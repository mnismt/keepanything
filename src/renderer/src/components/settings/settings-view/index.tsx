import * as stylex from '@stylexjs/stylex'
import { Check, Copy, FolderOpen, KeyRound, PlugZap, RotateCw, Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  AI_PROVIDER_DEFAULTS,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  EMBEDDING_MODEL_ID
} from '../../../../../shared/constants'
import type { AiProviderId, CaptureMode, Theme } from '../../../../../shared/types'
import { describeError, invoke } from '../../../lib/ipc-client'
import { useSettings } from '../../../state/settings'
import { useToasts } from '../../../state/toasts'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Button } from '../../common'
import { GmiCloudLogo, OpenRouterLogo } from '../provider-logo'
import { styles } from './styles'

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      {children}
    </div>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section {...stylex.props(styles.section)} aria-label={title}>
      <div {...stylex.props(styles.sectionHead)}>
        <span {...stylex.props(shared.eyebrow)}>{title}</span>
        {sub ? <span {...stylex.props(styles.sectionSub)}>{sub}</span> : null}
      </div>
      <div {...stylex.props(styles.card)}>{children}</div>
    </section>
  )
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (next: T) => void
  label: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} {...stylex.props(styles.seg)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          {...stylex.props(styles.segBtn, option.value === value && styles.segOn)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
] as const satisfies ReadonlyArray<{ value: Theme; label: string }>

const IMPORT_MODES = [
  { value: 'copy', label: 'Copy into library' },
  { value: 'reference', label: 'Reference in place' }
] as const satisfies ReadonlyArray<{ value: CaptureMode; label: string }>

const PROVIDERS = [
  { value: 'gmi', label: 'GMI Cloud' },
  { value: 'openrouter', label: 'OpenRouter' }
] as const satisfies ReadonlyArray<{ value: AiProviderId; label: string }>

const PROVIDER_META: Record<
  AiProviderId,
  { name: string; sub: string; keyPlaceholder: string; keyAria: string; modelPlaceholder: string; modelHint: string }
> = {
  gmi: {
    name: 'GMI Cloud',
    sub: 'MiniMax reasoning via OpenAI-compatible chat completions',
    keyPlaceholder: 'Paste your GMI Cloud key',
    keyAria: 'GMI API key',
    modelPlaceholder: DEFAULT_MODEL,
    modelHint: ''
  },
  openrouter: {
    name: 'OpenRouter',
    sub: 'OpenAI-compatible chat completions via OpenRouter',
    keyPlaceholder: 'Paste your OpenRouter key',
    keyAria: 'OpenRouter API key',
    modelPlaceholder: AI_PROVIDER_DEFAULTS.openrouter.model,
    modelHint: 'Any OpenRouter model ID that supports tools and image input. Usage is billed by OpenRouter.'
  }
}

/**
 * The plain key is never rendered back: only `apiKeyMasked` from main.
 */
export function SettingsView(): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const stats = useSettings((s) => s.stats)
  const update = useSettings((s) => s.update)
  const testing = useSettings((s) => s.testing)
  const lastTest = useSettings((s) => s.lastTest)
  const testConnection = useSettings((s) => s.testConnection)
  const reprocessAll = useSettings((s) => s.reprocessAll)
  const pop = useUi((s) => s.pop)
  const push = useToasts((s) => s.push)
  const [key, setKey] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [model, setModel] = useState(settings?.model ?? DEFAULT_MODEL)
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? DEFAULT_BASE_URL)
  const [confirmReprocess, setConfirmReprocess] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const selectedProvider: AiProviderId = settings?.provider ?? 'gmi'
  const providerMeta = PROVIDER_META[selectedProvider]

  useEffect(() => {
    if (settings) {
      setModel(settings.model)
      setBaseUrl(settings.baseUrl)
      setKey('')
      setEditingKey(false)
    }
  }, [settings])
  useEffect(() => sheetRef.current?.querySelector<HTMLElement>('button, input, select')?.focus(), [])

  const saveKey = async (): Promise<void> => {
    const trimmed = key.trim()
    if (!trimmed) return
    const r = await update({ apiKey: trimmed, ai: 'on' })
    setKey('')
    if (r.ok) {
      setEditingKey(false)
      push({ text: 'Key saved. Kept on this Mac, encrypted.' })
      void testConnection()
    } else push({ text: describeError(r.error) })
  }

  const clearKey = async (): Promise<void> => {
    const r = await update({ clearApiKey: true })
    if (r.ok) push({ text: 'Key removed.' })
    else push({ text: describeError(r.error) })
  }

  const commit = async (patch: Parameters<typeof update>[0]): Promise<void> => {
    const r = await update(patch)
    if (!r.ok) push({ text: describeError(r.error) })
  }

  const copyPath = async (): Promise<void> => {
    if (!settings?.libraryPath) return
    await navigator.clipboard.writeText(settings.libraryPath)
    push({ text: 'Path copied.', detail: 'Paste it into Finder’s Go to Folder (⇧⌘G).' })
  }

  const revealLibrary = async (): Promise<void> => {
    const r = await invoke('system:revealLibrary', undefined)
    if (!r.ok) push({ text: describeError(r.error) })
  }

  const hasKey = settings?.hasApiKey ?? false
  const showKeyField = editingKey || !hasKey

  const status = !hasKey
    ? { tone: null, text: 'No key yet' }
    : testing
      ? { tone: null, text: 'Testing…' }
      : lastTest?.ok
        ? { tone: styles.dotOk, text: `Connected · ${lastTest.latencyMs} ms` }
        : lastTest
          ? { tone: styles.dotBad, text: 'Not reachable' }
          : { tone: null, text: 'Key saved' }

  const disableTest = testing || !hasKey
  const embeddings = settings
    ? settings.embeddings.provider === 'local'
      ? `Local · ${EMBEDDING_MODEL_ID.split('/')[1]} · ${settings.embeddings.dims}-d · ${settings.embeddings.modelPresent ? 'model present' : 'downloading'}`
      : settings.embeddings.provider === 'local-hash'
        ? 'Local fallback (model missing) · full-text search still works'
        : 'Off'
    : '…'

  return (
    <div {...stylex.props(styles.scrim)} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && pop()}>
      <div
        ref={sheetRef}
        {...stylex.props(styles.sheet, shared.selectable)}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-settings
      >
        <div {...stylex.props(styles.head)}>
          <h2 {...stylex.props(styles.title)}>Settings</h2>
          <Button icon variant="quiet" aria-label="Close settings" onClick={() => pop()}>
            <X size={16} strokeWidth={1.5} />
          </Button>
        </div>

        <Section title="Provider" sub="Used only to understand what you keep">
          <Row label="Provider">
            <div {...stylex.props(styles.control)}>
              <Seg
                label="Provider"
                value={selectedProvider}
                options={PROVIDERS}
                onChange={(v) => void commit({ provider: v })}
              />
            </div>
          </Row>
          <div {...stylex.props(styles.provider)}>
            <span {...stylex.props(styles.providerMark)}>
              {selectedProvider === 'gmi' ? <GmiCloudLogo mark height={16} /> : <OpenRouterLogo height={14} />}
            </span>
            <div {...stylex.props(styles.providerText)}>
              <span {...stylex.props(styles.providerName)}>
                {providerMeta.name}
                {selectedProvider === 'gmi' ? <span {...stylex.props(styles.badge)}>Default</span> : null}
              </span>
              <span {...stylex.props(styles.providerSub)}>{providerMeta.sub}</span>
            </div>
            <span {...stylex.props(styles.status)} aria-live="polite">
              <span {...stylex.props(styles.dot, status.tone)} />
              {status.text}
            </span>
          </div>

          <Row label="API key">
            {showKeyField ? (
              <div {...stylex.props(styles.control)}>
                <input
                  {...stylex.props(styles.field, styles.mono)}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasKey ? 'Paste a new key to replace it' : providerMeta.keyPlaceholder}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
                  aria-label={providerMeta.keyAria}
                />
                <Button small onClick={() => void saveKey()} disabled={!key.trim()}>
                  <Check size={14} strokeWidth={1.5} />
                  Save
                </Button>
                {hasKey ? (
                  <Button
                    small
                    variant="quiet"
                    onClick={() => {
                      setEditingKey(false)
                      setKey('')
                    }}
                  >
                    <X size={14} strokeWidth={1.5} />
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : (
              <div {...stylex.props(styles.control)}>
                <span {...stylex.props(styles.masked)}>••••••••{settings?.apiKeyMasked?.slice(-4) ?? ''}</span>
                <Button variant="quiet" small onClick={() => void testConnection()} disabled={disableTest}>
                  <PlugZap size={14} strokeWidth={1.5} />
                  Test
                </Button>
                <Button variant="quiet" small onClick={() => setEditingKey(true)}>
                  <KeyRound size={14} strokeWidth={1.5} />
                  Replace
                </Button>
                <Button variant="quiet" small onClick={() => void clearKey()}>
                  <Trash2 size={14} strokeWidth={1.5} />
                  Remove
                </Button>
              </div>
            )}
            <span {...stylex.props(styles.hint, lastTest && !lastTest.ok && styles.bad)}>
              {lastTest && !lastTest.ok
                ? `Couldn't connect · ${lastTest.error ?? 'unknown error'}`
                : 'Stored encrypted on this Mac. Never written to logs or shown again.'}
            </span>
          </Row>
          <Row label="Base URL">
            <div {...stylex.props(styles.control)}>
              <input
                {...stylex.props(styles.field, styles.mono)}
                value={baseUrl}
                spellCheck={false}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() =>
                  baseUrl.trim() && baseUrl.trim() !== settings?.baseUrl && void commit({ baseUrl: baseUrl.trim() })
                }
                aria-label="Base URL"
              />
            </div>
          </Row>
          <Row label="Model">
            <div {...stylex.props(styles.control)}>
              <input
                {...stylex.props(styles.field, styles.mono)}
                value={model}
                spellCheck={false}
                placeholder={providerMeta.modelPlaceholder}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => model.trim() !== settings?.model && void commit({ model: model.trim() })}
                aria-label="Model"
              />
            </div>
            {providerMeta.modelHint ? <span {...stylex.props(styles.hint)}>{providerMeta.modelHint}</span> : null}
          </Row>
        </Section>

        <Section title="Library">
          <Row label="Theme">
            <div {...stylex.props(styles.control)}>
              <Seg
                label="Theme"
                value={settings?.theme ?? 'system'}
                options={THEMES}
                onChange={(v) => void commit({ theme: v })}
              />
            </div>
          </Row>
          <Row label="Import">
            <div {...stylex.props(styles.control)}>
              <Seg
                label="Import mode"
                value={settings?.importMode ?? 'copy'}
                options={IMPORT_MODES}
                onChange={(v) => void commit({ importMode: v })}
              />
            </div>
          </Row>
          <Row label="Location">
            <div {...stylex.props(styles.control)}>
              <span {...stylex.props(styles.path)} title={settings?.libraryPath}>
                {settings?.libraryPath ?? '…'}
              </span>
              <Button
                icon
                small
                variant="quiet"
                aria-label="Copy library path"
                title="Copy path"
                onClick={() => void copyPath()}
              >
                <Copy size={16} strokeWidth={1.5} />
              </Button>
              <Button
                icon
                small
                variant="quiet"
                aria-label="Show library in Finder"
                title="Show in Finder"
                onClick={() => void revealLibrary()}
              >
                <FolderOpen size={16} strokeWidth={1.5} />
              </Button>
            </div>
          </Row>
          <Row label="Embeddings">
            <span {...stylex.props(styles.value)}>{embeddings}</span>
          </Row>
        </Section>

        <Section title="Library at a glance">
          <div {...stylex.props(styles.stats)}>
            {(
              [
                ['items', stats?.items],
                ['connections', stats?.connections],
                ['collections', stats?.collections],
                ['in progress', stats?.processing]
              ] as const
            ).map(([label, n]) => (
              <div key={label} {...stylex.props(styles.stat)}>
                <span {...stylex.props(styles.statValue)}>{n ?? '–'}</span>
                <span {...stylex.props(styles.statLabel)}>{label}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Privacy">
          <div {...stylex.props(styles.privacy)}>
            <div {...stylex.props(styles.privacyCol)}>
              <h4 {...stylex.props(shared.eyebrow, styles.privacyHead)}>Stays on this Mac</h4>
              Originals, thumbnails, extracted text, the search index, embeddings, collections, relationships and the
              run log.
            </div>
            <div {...stylex.props(styles.privacyCol)}>
              <h4 {...stylex.props(shared.eyebrow, styles.privacyHead)}>Sent to the provider</h4>
              Only while understanding: a trimmed excerpt of one item at a time (or a downscaled image), plus one-line
              summaries of related items. Never the whole library.
              {selectedProvider === 'openrouter' ? (
                <> Requests go through OpenRouter to the selected model's upstream provider.</>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title="Danger zone">
          <div {...stylex.props(styles.dangerBox)}>
            <span {...stylex.props(styles.dangerText)} id="reset-data-description">
              <span {...stylex.props(styles.dangerTitle)}>Reset data</span>
              Remove all items, activity logs, app-managed files, notes and saved settings, including API keys. Original
              files outside the library are kept. The app will restart. This cannot be undone.
            </span>
            <Button
              variant="danger"
              small
              disabled={resetting}
              aria-describedby="reset-data-description"
              aria-busy={resetting}
              onClick={async () => {
                setResetting(true)
                setResetError(null)
                try {
                  const result = await invoke('settings:resetData', undefined)
                  if (!result.ok) setResetError(describeError(result.error))
                } catch {
                  setResetError("Couldn't reset data. Please try again.")
                } finally {
                  setResetting(false)
                }
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
              Reset data
            </Button>
          </div>
          {resetError ? (
            <p role="alert" {...stylex.props(styles.privacyCol, styles.bad)}>
              {resetError}
            </p>
          ) : null}
          <div {...stylex.props(styles.dangerBox)}>
            <span {...stylex.props(styles.dangerText)}>
              <span {...stylex.props(styles.dangerTitle)}>Reprocess everything</span>
              Re-reads and re-understands every item in the background. Your edits are kept; nothing is deleted.
            </span>
            {confirmReprocess ? (
              <>
                <Button variant="quiet" small onClick={() => setConfirmReprocess(false)}>
                  <X size={14} strokeWidth={1.5} />
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  small
                  onClick={async () => {
                    setConfirmReprocess(false)
                    const n = await reprocessAll()
                    push({ text: n === null ? "Couldn't start that." : `Re-reading ${n} items in the background.` })
                  }}
                >
                  <RotateCw size={14} strokeWidth={1.5} />
                  Yes, reprocess {stats?.items ?? ''}
                </Button>
              </>
            ) : (
              <Button variant="quiet" small onClick={() => setConfirmReprocess(true)}>
                <RotateCw size={14} strokeWidth={1.5} />
                Reprocess…
              </Button>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}
