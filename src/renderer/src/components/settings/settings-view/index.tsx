import * as stylex from '@stylexjs/stylex'
import { Copy, FolderOpen, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../../../../../shared/constants'
import type { AiMode, CaptureMode, Theme } from '../../../../../shared/types'
import { describeError, invoke } from '../../../lib/ipc-client'
import { useSettings } from '../../../state/settings'
import { useToasts } from '../../../state/toasts'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Button } from '../../common'
import { styles } from './styles'

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      {children}
    </div>
  )
}

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

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
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (settings) {
      setModel(settings.model)
      setBaseUrl(settings.baseUrl)
    }
  }, [settings])
  useEffect(() => sheetRef.current?.querySelector<HTMLElement>('button, input, select')?.focus(), [])

  const saveKey = async (): Promise<void> => {
    const trimmed = key.trim()
    if (!trimmed) return
    const r = await update({ apiKey: trimmed, aiMode: 'gmi' })
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

        <section {...stylex.props(styles.section)} aria-label="GMI Cloud">
          <div {...stylex.props(styles.sectionHead)}>
            <h3 {...stylex.props(styles.sectionTitle)}>GMI Cloud</h3>
            <span {...stylex.props(styles.sectionSub)}>MiniMax reasoning, used only to understand what you keep</span>
          </div>
          <Row label="API key">
            {showKeyField ? (
              <div {...stylex.props(styles.control)}>
                <input
                  {...stylex.props(styles.field, styles.mono)}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasKey ? 'Paste a new key to replace it' : 'Paste your GMI key'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
                  aria-label="GMI API key"
                />
                <Button onClick={() => void saveKey()} disabled={!key.trim()}>
                  Save
                </Button>
                {hasKey ? (
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setEditingKey(false)
                      setKey('')
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : (
              <div {...stylex.props(styles.control)}>
                <span {...stylex.props(styles.masked)}>••••••••{settings?.apiKeyMasked?.slice(-4) ?? ''}</span>
                <Button variant="quiet" small onClick={() => setEditingKey(true)}>
                  Replace
                </Button>
                <Button variant="quiet" small onClick={() => void clearKey()}>
                  Remove
                </Button>
                <Button variant="quiet" small onClick={() => void testConnection()} disabled={testing}>
                  {testing ? 'Testing…' : 'Test connection'}
                </Button>
              </div>
            )}
            {lastTest ? (
              <span {...stylex.props(styles.hint, lastTest.ok ? styles.ok : styles.bad)}>
                {lastTest.ok
                  ? `Connected · ${lastTest.model} · ${lastTest.latencyMs} ms`
                  : `Couldn't connect · ${lastTest.error ?? 'unknown error'}`}
              </span>
            ) : (
              <span {...stylex.props(styles.hint)}>
                Stored encrypted on this Mac. Never written to logs or shown again.
              </span>
            )}
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
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => model.trim() && model.trim() !== settings?.model && void commit({ model: model.trim() })}
                aria-label="Model"
              />
            </div>
          </Row>
          <Row label="AI mode">
            <div {...stylex.props(styles.control)}>
              <select
                {...stylex.props(styles.field, styles.select)}
                value={settings?.aiMode ?? 'off'}
                onChange={(e) => void commit({ aiMode: e.target.value as AiMode })}
                aria-label="AI mode"
              >
                <option value="gmi">GMI Cloud (MiniMax)</option>
                <option value="mock">Mock — offline, deterministic</option>
                <option value="off">Off — keep only, never understand</option>
              </select>
            </div>
          </Row>
        </section>

        <section {...stylex.props(styles.section)} aria-label="Appearance and library">
          <h3 {...stylex.props(styles.sectionTitle)}>Library</h3>
          <Row label="Theme">
            <div {...stylex.props(styles.seg)} role="radiogroup" aria-label="Theme">
              {THEMES.map((t, i) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={(settings?.theme ?? 'system') === t.value}
                  {...stylex.props(
                    shared.hoverFade,
                    styles.segBtn,
                    i === THEMES.length - 1 && styles.segLast,
                    (settings?.theme ?? 'system') === t.value && styles.segOn
                  )}
                  onClick={() => void commit({ theme: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Import mode">
            <div {...stylex.props(styles.control)}>
              <select
                {...stylex.props(styles.field, styles.select)}
                value={settings?.importMode ?? 'copy'}
                onChange={(e) => void commit({ importMode: e.target.value as CaptureMode })}
                aria-label="Import mode"
              >
                <option value="copy">Copy files into the library</option>
                <option value="reference">Reference originals where they are</option>
              </select>
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
                <Copy size={14} strokeWidth={1.5} />
              </Button>
              <Button small variant="quiet" title="Show library in Finder" onClick={() => void revealLibrary()}>
                <FolderOpen size={14} strokeWidth={1.5} />
                Show in Finder
              </Button>
            </div>
          </Row>
          <Row label="Embeddings">
            <span {...stylex.props(styles.hint)}>
              {settings
                ? settings.embeddings.provider === 'minilm'
                  ? `Local MiniLM · ${settings.embeddings.dims}-d · ${settings.embeddings.modelPresent ? 'model present' : 'model downloading'}`
                  : settings.embeddings.provider === 'local-hash'
                    ? 'Lightweight local fallback (model missing) · full-text search still works'
                    : 'Off'
                : '…'}
            </span>
          </Row>
          <div {...stylex.props(styles.stats)}>
            <div {...stylex.props(styles.stat)}>
              <span {...stylex.props(styles.statValue)}>{stats?.items ?? '–'}</span>
              <span {...stylex.props(styles.statLabel)}>items</span>
            </div>
            <div {...stylex.props(styles.stat)}>
              <span {...stylex.props(styles.statValue)}>{stats?.connections ?? '–'}</span>
              <span {...stylex.props(styles.statLabel)}>connections</span>
            </div>
            <div {...stylex.props(styles.stat)}>
              <span {...stylex.props(styles.statValue)}>{stats?.collections ?? '–'}</span>
              <span {...stylex.props(styles.statLabel)}>collections</span>
            </div>
            <div {...stylex.props(styles.stat)}>
              <span {...stylex.props(styles.statValue)}>{stats?.processing ?? '–'}</span>
              <span {...stylex.props(styles.statLabel)}>in progress</span>
            </div>
          </div>
        </section>

        <section {...stylex.props(styles.section)} aria-label="Privacy">
          <h3 {...stylex.props(styles.sectionTitle)}>Privacy</h3>
          <div {...stylex.props(styles.privacy)}>
            <div>
              <h4 {...stylex.props(shared.eyebrow, styles.privacyHead)}>Stays on this Mac</h4>
              Originals, thumbnails, extracted text, the search index, embeddings, collections, relationships and the
              run log.
            </div>
            <div>
              <h4 {...stylex.props(shared.eyebrow, styles.privacyHead)}>Sent to GMI, only while understanding</h4>A
              trimmed excerpt of one item at a time (or a downscaled image), plus one-line summaries of related items.
              Never the whole library.
            </div>
          </div>
        </section>

        <section {...stylex.props(styles.section)} aria-label="Danger zone">
          <h3 {...stylex.props(styles.sectionTitle)}>Danger zone</h3>
          <div {...stylex.props(styles.dangerBox)}>
            <span {...stylex.props(styles.dangerText)}>
              <span {...stylex.props(styles.dangerTitle)}>Reprocess everything</span>
              Re-reads and re-understands every item in the background. Your edits are kept; nothing is deleted.
            </span>
            {confirmReprocess ? (
              <>
                <Button variant="quiet" small onClick={() => setConfirmReprocess(false)}>
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
                  Yes, reprocess {stats?.items ?? ''}
                </Button>
              </>
            ) : (
              <Button variant="quiet" small onClick={() => setConfirmReprocess(true)}>
                Reprocess…
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
