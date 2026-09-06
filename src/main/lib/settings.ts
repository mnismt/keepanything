import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_PROVIDER_DEFAULTS, EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from '../../shared/constants'
import type { AiMode, AiProviderId, AiStatus, CaptureMode, Settings, SettingsPatch, Theme } from '../../shared/types'
import type { Paths, SecretStore } from '../ports'
import { writeFileAtomicSync } from './fs'

/** Per-provider persisted profile; secrets stay encrypted in `secrets`. */
export interface ProviderProfile {
  model?: string
  baseUrl?: string
}

export type ProviderProfiles = Partial<Record<AiProviderId, ProviderProfile>>

/** Values read from the environment (`.env` in dev) used when nothing is stored. */
export interface EnvDefaults {
  aiMode?: AiMode
  providers?: Partial<Record<AiProviderId, ProviderProfile & { apiKey?: string }>>
}

export const AI_PROVIDERS: readonly AiProviderId[] = ['gmi', 'openrouter']
const AI_MODES: readonly string[] = [...AI_PROVIDERS, 'mock', 'off']

/** Runtime validator; includes `mock` so `KEEPANYTHING_AI=mock` still resolves in dev / E2E. */
export function isAiMode(value: unknown): value is AiMode {
  return typeof value === 'string' && AI_MODES.includes(value)
}

function isProvider(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
}

/** GMI keeps its historical variable names (`KEEPANYTHING_MODEL` has no `GMI_` infix). */
const ENV_VARS: Record<AiProviderId, Record<'apiKey' | 'baseUrl' | 'model', string>> = {
  gmi: { apiKey: 'KEEPANYTHING_GMI_API_KEY', baseUrl: 'KEEPANYTHING_GMI_BASE_URL', model: 'KEEPANYTHING_MODEL' },
  openrouter: {
    apiKey: 'KEEPANYTHING_OPENROUTER_API_KEY',
    baseUrl: 'KEEPANYTHING_OPENROUTER_BASE_URL',
    model: 'KEEPANYTHING_OPENROUTER_MODEL'
  }
}

/** The `gmi` secret name predates multi-provider support and must not change (existing keychains). */
const SECRET_KEYS: Record<AiProviderId, string> = { gmi: 'gmiApiKey', openrouter: 'openrouterApiKey' }

/** Pick the KeepAnything variables out of an environment map (never logs them). */
export function readEnvDefaults(env: Record<string, string | undefined>): EnvDefaults {
  const out: EnvDefaults = {}
  const mode = env.KEEPANYTHING_AI?.trim()
  if (isAiMode(mode)) out.aiMode = mode
  for (const id of AI_PROVIDERS) {
    const profile: ProviderProfile & { apiKey?: string } = {}
    for (const field of ['apiKey', 'baseUrl', 'model'] as const) {
      const value = env[ENV_VARS[id][field]]?.trim()
      if (value) profile[field] = value
    }
    if (Object.keys(profile).length > 0) {
      out.providers ??= {}
      out.providers[id] = profile
    }
  }
  return out
}

/** Non-secret settings. `ai` is the on/off switch; `provider` picks whose profile and key are live. */
interface StoredSettings {
  ai?: 'on' | 'off'
  provider?: AiProviderId
  providers?: ProviderProfiles
  importMode?: CaptureMode
  theme?: Theme
}

interface ConfigFile {
  version: 2
  settings: StoredSettings
  /** Encrypted values, base64. */
  secrets: Record<string, string>
}

function normalizeProfile(input: unknown): ProviderProfile {
  const out: ProviderProfile = {}
  if (input && typeof input === 'object') {
    const { model, baseUrl } = input as ProviderProfile
    if (typeof model === 'string') out.model = model
    if (typeof baseUrl === 'string') out.baseUrl = baseUrl
  }
  return out
}

/**
 * Accepts v1 documents (`aiMode: 'gmi'|'mock'|'off'`, flat `model`/`baseUrl`) and v2 documents; always
 * yields the v2 shape. A v1 `mock` is dropped rather than migrated: `mock` is env-driven only.
 */
function normalizeStoredSettings(input: unknown): StoredSettings {
  const out: StoredSettings = {}
  if (!input || typeof input !== 'object') return out
  const raw = input as Record<string, unknown>
  if (raw.ai === 'on' || raw.ai === 'off') out.ai = raw.ai
  else if (raw.aiMode === 'off') out.ai = 'off'
  else if (isProvider(raw.aiMode)) {
    out.ai = 'on'
    out.provider = raw.aiMode
  }
  if (isProvider(raw.provider)) out.provider = raw.provider
  if (raw.importMode === 'copy' || raw.importMode === 'reference') out.importMode = raw.importMode
  if (raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark') out.theme = raw.theme
  const profiles: ProviderProfiles = {}
  const stored = (raw.providers ?? {}) as Record<string, unknown>
  for (const id of AI_PROVIDERS) {
    const profile = normalizeProfile(stored[id])
    if (Object.keys(profile).length > 0) profiles[id] = profile
  }
  if (!profiles.gmi && (typeof raw.model === 'string' || typeof raw.baseUrl === 'string')) {
    profiles.gmi = normalizeProfile(raw)
  }
  if (Object.keys(profiles).length > 0) out.providers = profiles
  return out
}

/** Small JSON document store shared by settings and secrets; atomic writes. */
export interface ConfigDocument {
  read(): ConfigFile
  write(mutate: (doc: ConfigFile) => void): void
}

/** Open (or create in memory) the config document at `file`. Throws on an unknown version. */
export function openConfigDocument(file: string): ConfigDocument {
  let cache: ConfigFile | null = null
  const load = (): ConfigFile => {
    if (cache) return cache
    let raw: { version?: number; settings?: unknown; secrets?: unknown } = {}
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // Missing or corrupt file: start empty.
    }
    const version = raw.version ?? 1
    if (version !== 1 && version !== 2) throw new Error('Unsupported settings configuration version.')
    cache = {
      version: 2,
      settings: normalizeStoredSettings(raw.settings),
      secrets: raw.secrets && typeof raw.secrets === 'object' ? (raw.secrets as Record<string, string>) : {}
    }
    return cache
  }
  return {
    read: load,
    write(mutate) {
      const doc = load()
      mutate(doc)
      doc.settings = normalizeStoredSettings(doc.settings)
      writeFileAtomicSync(file, `${JSON.stringify(doc, null, 2)}\n`)
    }
  }
}

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
  /** Plain API key for the selected provider: stored (encrypted) first, environment fallback second. */
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

  const keyFor = (id: AiProviderId): string | null =>
    secrets.get(SECRET_KEYS[id]) ?? env.providers?.[id]?.apiKey ?? null

  /** Stored choice -> `KEEPANYTHING_AI=<provider>` -> first provider with a key -> gmi. */
  const selectedProvider = (stored: StoredSettings): AiProviderId =>
    stored.provider ?? (isProvider(env.aiMode) ? env.aiMode : (AI_PROVIDERS.find((id) => keyFor(id) !== null) ?? 'gmi'))

  const get = (): Settings => {
    const stored = document.read().settings
    const provider = selectedProvider(stored)
    const key = keyFor(provider)
    const defaults = AI_PROVIDER_DEFAULTS[provider]
    // Stored fields win over env per field.
    const profile = { ...env.providers?.[provider], ...stored.providers?.[provider] }
    const envMode = env.aiMode
    const aiMode: AiMode =
      stored.ai === 'off'
        ? 'off'
        : stored.ai === 'on'
          ? provider
          : envMode === 'mock' || envMode === 'off'
            ? envMode
            : envMode !== undefined || key
              ? provider
              : 'off'
    return {
      aiMode,
      provider,
      model: profile.model ?? defaults.model,
      baseUrl: (profile.baseUrl || defaults.baseUrl).replace(/\/+$/, ''),
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
      const provider = patch.provider ?? selectedProvider(document.read().settings)
      const defaults = AI_PROVIDER_DEFAULTS[provider]
      document.write(({ settings: s }) => {
        if (patch.provider) s.provider = patch.provider
        if (patch.ai) s.ai = patch.ai
        if (patch.model !== undefined || patch.baseUrl !== undefined) {
          const profile = { ...s.providers?.[provider] }
          if (patch.model !== undefined) profile.model = patch.model.trim() || defaults.model
          if (patch.baseUrl !== undefined) {
            profile.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '') || defaults.baseUrl
          }
          s.providers = { ...s.providers, [provider]: profile }
        }
        if (patch.importMode) s.importMode = patch.importMode
        if (patch.theme) s.theme = patch.theme
      })
      if (patch.clearApiKey) secrets.delete(SECRET_KEYS[provider])
      else if (patch.apiKey?.trim()) secrets.set(SECRET_KEYS[provider], patch.apiKey.trim())
      aiStatusOverride = null
      return notify()
    },
    apiKey: () => keyFor(selectedProvider(document.read().settings)),
    aiStatus() {
      if (aiStatusOverride) return aiStatusOverride
      const s = get()
      if (s.aiMode === 'off') return 'off'
      if (s.aiMode === 'mock') return 'connected'
      return s.hasApiKey && s.model ? 'connected' : 'unconfigured'
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
