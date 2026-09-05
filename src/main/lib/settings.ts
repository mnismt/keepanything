import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_BASE_URL, DEFAULT_MODEL, EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from '../../shared/constants'
import type { AiMode, AiStatus, CaptureMode, Settings, SettingsPatch, Theme } from '../../shared/types'
import type { Paths, SecretStore } from '../ports'
import { writeFileAtomicSync } from './fs'

/** Values read from the environment (`.env` in dev) used when nothing is stored. */
export interface EnvDefaults {
  apiKey?: string
  baseUrl?: string
  model?: string
  aiMode?: AiMode
}

const AI_MODES: readonly AiMode[] = ['gmi', 'mock', 'off']

/** Runtime validator; includes `mock` so `KEEPANYTHING_AI=mock` still resolves in dev / E2E. */
export function isAiMode(value: unknown): value is AiMode {
  return typeof value === 'string' && (AI_MODES as readonly string[]).includes(value)
}

/** Pick the KeepAnything variables out of an environment map (never logs them). */
export function readEnvDefaults(env: Record<string, string | undefined>): EnvDefaults {
  const out: EnvDefaults = {}
  const key = env.KEEPANYTHING_GMI_API_KEY?.trim()
  const baseUrl = env.KEEPANYTHING_GMI_BASE_URL?.trim()
  const model = env.KEEPANYTHING_MODEL?.trim()
  const mode = env.KEEPANYTHING_AI?.trim()
  if (key) out.apiKey = key
  if (baseUrl) out.baseUrl = baseUrl
  if (model) out.model = model
  if (isAiMode(mode)) out.aiMode = mode
  return out
}

/** What `config.json` persists (the API key is stored encrypted, in `secrets`). */
interface StoredSettings {
  aiMode?: AiMode
  model?: string
  baseUrl?: string
  importMode?: CaptureMode
  theme?: Theme
}

interface ConfigFile {
  version: 1
  settings: StoredSettings
  /** Encrypted values, base64. */
  secrets: Record<string, string>
}

/** Small JSON document store shared by settings and secrets; atomic writes. */
export interface ConfigDocument {
  read(): ConfigFile
  write(mutate: (doc: ConfigFile) => void): void
}

/** Open (or create in memory) the config document at `file`. */
export function openConfigDocument(file: string): ConfigDocument {
  let cache: ConfigFile | null = null
  const load = (): ConfigFile => {
    if (cache) return cache
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ConfigFile>
      cache = {
        version: 1,
        settings: typeof parsed.settings === 'object' && parsed.settings ? parsed.settings : {},
        secrets: typeof parsed.secrets === 'object' && parsed.secrets ? parsed.secrets : {}
      }
    } catch {
      cache = { version: 1, settings: {}, secrets: {} }
    }
    return cache
  }
  return {
    read: load,
    write(mutate) {
      const doc = load()
      mutate(doc)
      writeFileAtomicSync(file, `${JSON.stringify(doc, null, 2)}\n`)
    }
  }
}

export const API_KEY_SECRET = 'gmiApiKey'

/** Mask a key for display: first 3 + last 4 characters. */
export function maskApiKey(key: string): string {
  if (key.length < 12) return '••••'
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export function embeddingModelPresent(modelsDir: string): boolean {
  const dir = join(modelsDir, EMBEDDING_MODEL_ID)
  try {
    return existsSync(dir) && readdirSync(dir).length > 0
  } catch {
    return false
  }
}

/** Settings + API key access (`lib/config.ts` wires it to `safeStorage`). */
export interface SettingsStore {
  get(): Settings
  update(patch: SettingsPatch): Settings
  /** Plain API key: stored (encrypted) first, environment fallback second. Never logged. */
  apiKey(): string | null
  /** Effective connectivity for the footer. */
  aiStatus(): AiStatus
  setAiStatus(status: AiStatus | null): void
  setEmbeddingsStatus(status: Settings['embeddings']): void
  onChange(listener: (settings: Settings) => void): () => void
}

export interface SettingsStoreDeps {
  document: ConfigDocument
  secrets: SecretStore
  env: EnvDefaults
  paths: Pick<Paths, 'userData' | 'modelsDir'>
}

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const { document, secrets, env, paths } = deps
  const listeners = new Set<(s: Settings) => void>()
  let aiStatusOverride: AiStatus | null = null
  let embeddings: Settings['embeddings'] = {
    provider: 'none',
    modelPresent: embeddingModelPresent(paths.modelsDir),
    dims: EMBEDDING_DIMS
  }

  const apiKey = (): string | null => secrets.get(API_KEY_SECRET) ?? env.apiKey ?? null

  const get = (): Settings => {
    const stored = document.read().settings
    const key = apiKey()
    return {
      // ponytail: a stored `mock` is ignored rather than migrated. `mock` is env-driven only
      // (E2E, screenshot, seed-library) and no longer user-selectable; the stale value is inert
      // and the next settings write overwrites it.
      aiMode: (stored.aiMode === 'mock' ? undefined : stored.aiMode) ?? env.aiMode ?? (key ? 'gmi' : 'off'),
      model: stored.model ?? env.model ?? DEFAULT_MODEL,
      baseUrl: stored.baseUrl ?? env.baseUrl ?? DEFAULT_BASE_URL,
      hasApiKey: key !== null,
      apiKeyMasked: key ? maskApiKey(key) : null,
      importMode: stored.importMode ?? 'copy',
      theme: stored.theme ?? 'system',
      libraryPath: paths.userData,
      embeddings
    }
  }

  const notify = (): Settings => {
    const settings = get()
    for (const l of listeners) l(settings)
    return settings
  }

  return {
    get,
    update(patch) {
      document.write((doc) => {
        if (patch.aiMode !== undefined) doc.settings.aiMode = patch.aiMode
        if (patch.model !== undefined) doc.settings.model = patch.model.trim() || DEFAULT_MODEL
        if (patch.baseUrl !== undefined)
          doc.settings.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL
        if (patch.importMode !== undefined) doc.settings.importMode = patch.importMode
        if (patch.theme !== undefined) doc.settings.theme = patch.theme
      })
      if (patch.clearApiKey) secrets.delete(API_KEY_SECRET)
      else if (patch.apiKey !== undefined && patch.apiKey.trim().length > 0)
        secrets.set(API_KEY_SECRET, patch.apiKey.trim())
      aiStatusOverride = null
      return notify()
    },
    apiKey,
    aiStatus() {
      if (aiStatusOverride) return aiStatusOverride
      const s = get()
      if (s.aiMode === 'off') return 'off'
      if (s.aiMode === 'gmi' && !s.hasApiKey) return 'unconfigured'
      return 'connected'
    },
    setAiStatus(status) {
      aiStatusOverride = status
    },
    setEmbeddingsStatus(status) {
      embeddings = status
      notify()
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/** Secret store kept in memory only (tests, or when `safeStorage` is unavailable). */
export function createMemorySecretStore(available = true): SecretStore {
  const values = new Map<string, string>()
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value)
    },
    delete: (key) => {
      values.delete(key)
    },
    available: () => available
  }
}
