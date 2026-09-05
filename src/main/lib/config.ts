import { safeStorage } from 'electron'
import type { Logger, Paths, SecretStore } from '../ports'
import { configFile } from '../storage/paths'
import {
  type ConfigDocument,
  createMemorySecretStore,
  createSettingsStore,
  type EnvDefaults,
  openConfigDocument,
  type SettingsStore
} from './settings'

/**
 * `safeStorage`-backed secret store persisted (encrypted, base64) inside `config.json`. Must be
 * created after `app.whenReady()`. A decrypt failure reads as "no key", never as a crash.
 */
export function createSafeStorageSecretStore(document: ConfigDocument, logger: Logger): SecretStore {
  const available = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }
  if (!available()) {
    logger.warn('safeStorage unavailable; secrets will not persist')
    return createMemorySecretStore(false)
  }
  return {
    available,
    get(key) {
      const encoded = document.read().secrets[key]
      if (!encoded) return null
      try {
        return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
      } catch (error) {
        logger.warn('could not decrypt stored secret; treating as absent', { key, error })
        return null
      }
    },
    set(key, value) {
      const encrypted = safeStorage.encryptString(value).toString('base64')
      document.write((doc) => {
        doc.secrets[key] = encrypted
      })
    },
    delete(key) {
      document.write((doc) => {
        delete doc.secrets[key]
      })
    }
  }
}

/** Settings + secrets over `<userData>/config.json`. Call after `app.whenReady()`. */
export function createConfig(paths: Paths, env: EnvDefaults, logger: Logger): SettingsStore {
  const document = openConfigDocument(configFile(paths))
  const secrets = createSafeStorageSecretStore(document, logger)
  return createSettingsStore({ document, secrets, env, paths })
}
