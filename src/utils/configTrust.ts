import { createHash } from 'node:crypto'
import fs from 'fs-extra'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Config Trust Store (direnv-style)
 *
 * Post-commands defined in a `.pando.toml` execute with `shell: true`. That is
 * fine for the user's own config, but a `.pando.toml` committed in a repo the
 * user just cloned would otherwise run arbitrary shell silently on `pando add`.
 *
 * This module implements a trust store, modeled on direnv's `.envrc` allow-list:
 * a config file's post-commands only run automatically once the user has trusted
 * that exact file at its current content hash. Changing the file's contents
 * invalidates the trust and re-triggers the prompt.
 *
 * Filesystem I/O lives in thin wrappers (load/save/record/check). The trust
 * DECISION is a pure function (`decidePostCommandTrust`) so it is unit-testable
 * without touching disk.
 */

/** Current on-disk schema version for the trust store. */
export const TRUST_STORE_VERSION = 1

/**
 * A single trust entry: the SHA-256 hash of the config file's contents at the
 * time it was trusted, plus when it was trusted.
 */
export interface TrustEntry {
  hash: string
  trustedAt: string
}

/**
 * Shape of the trust store file.
 * Keys of `trusted` are absolute config file paths.
 */
export interface TrustStore {
  version: number
  trusted: Record<string, TrustEntry>
}

/**
 * The action the caller should take for a config file's post-commands.
 * - `run`: execute the post-commands
 * - `prompt`: ask the user (interactively) whether to trust + run
 * - `skip`: do not run; warn the user how to trust
 */
export type TrustDecision = 'run' | 'prompt' | 'skip'

/**
 * Inputs to the pure trust-decision function.
 */
export interface TrustDecisionInput {
  /** Whether there are any post-command scripts to consider */
  hasScripts: boolean
  /**
   * Absolute path of the config FILE that supplied the post-commands, or
   * undefined when they came purely from environment variables (no file).
   */
  sourcePath?: string
  /** Whether the env escape hatch (PANDO_TRUST_CONFIG=1/true) is set */
  envTrust: boolean
  /** Whether the source file is already trusted with a matching content hash */
  trustedWithMatchingHash: boolean
  /** Whether stdin is an interactive TTY (so we can prompt) */
  isTty: boolean
  /** Whether --json output mode is active (never prompt in JSON mode) */
  isJson: boolean
}

/**
 * Decide what to do with a config file's post-commands. Pure function — no I/O.
 *
 * Precedence:
 * 1. No scripts → `skip` (nothing to run).
 * 2. Scripts but no source file (env-only) → `run` (implicitly trusted).
 * 3. PANDO_TRUST_CONFIG env escape hatch → `run`.
 * 4. File already trusted with matching hash → `run`.
 * 5. Interactive TTY and not JSON → `prompt`.
 * 6. Otherwise (non-TTY or JSON) → `skip`.
 *
 * @param input - Decision inputs
 * @returns The trust decision
 */
export function decidePostCommandTrust(input: TrustDecisionInput): TrustDecision {
  if (!input.hasScripts) {
    return 'skip'
  }

  // Post-commands sourced purely from environment variables (no file on disk)
  // are implicitly trusted — there is no untrusted file to guard against.
  if (!input.sourcePath) {
    return 'run'
  }

  // CI / automation escape hatch.
  if (input.envTrust) {
    return 'run'
  }

  // Previously trusted at the current content hash.
  if (input.trustedWithMatchingHash) {
    return 'run'
  }

  // Can we ask the user? Only when interactive and not emitting machine output.
  if (input.isTty && !input.isJson) {
    return 'prompt'
  }

  // Non-interactive or JSON mode: do not run untrusted post-commands.
  return 'skip'
}

/**
 * Interpret the PANDO_TRUST_CONFIG environment variable.
 *
 * @param value - Raw env value (typically process.env.PANDO_TRUST_CONFIG)
 * @returns True when set to `1` or `true` (case-insensitive)
 */
export function isEnvTrustEnabled(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/**
 * Compute the SHA-256 hash of a string of config file content.
 *
 * @param content - The raw file content
 * @returns Lowercase hex SHA-256 digest
 */
export function hashConfigContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Compute the SHA-256 hash of a config file's current contents on disk.
 *
 * @param filePath - Absolute path to the config file
 * @returns Lowercase hex SHA-256 digest of the file's contents
 */
export async function computeConfigHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf8')
  return hashConfigContent(content)
}

/**
 * Resolve the directory that holds the trust store.
 *
 * Honors $XDG_CONFIG_HOME, falling back to ~/.config. The trust store lives at
 * `<config dir>/pando/trusted-configs.json`.
 *
 * @returns Absolute path to the pando config directory
 */
export function getTrustStoreDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && xdg.trim().length > 0 ? xdg : path.join(os.homedir(), '.config')
  return path.join(base, 'pando')
}

/**
 * Resolve the absolute path to the trust store file.
 *
 * @returns Absolute path to trusted-configs.json
 */
export function getTrustStorePath(): string {
  return path.join(getTrustStoreDir(), 'trusted-configs.json')
}

/**
 * Load the trust store from disk.
 *
 * Returns a fresh empty store if the file is missing or unreadable/corrupted —
 * a corrupt trust store should never crash `pando add`; it just means nothing
 * is trusted yet.
 *
 * @returns The parsed trust store (or an empty one)
 */
export async function loadTrustStore(): Promise<TrustStore> {
  const storePath = getTrustStorePath()
  try {
    const content = await fs.readFile(storePath, 'utf8')
    const parsed = JSON.parse(content) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'trusted' in parsed &&
      typeof (parsed as { trusted: unknown }).trusted === 'object' &&
      (parsed as { trusted: unknown }).trusted !== null
    ) {
      const obj = parsed as { version?: unknown; trusted: Record<string, TrustEntry> }
      return {
        version: typeof obj.version === 'number' ? obj.version : TRUST_STORE_VERSION,
        trusted: obj.trusted,
      }
    }
  } catch {
    // Missing or corrupt store → treat as empty.
  }
  return { version: TRUST_STORE_VERSION, trusted: {} }
}

/**
 * Persist the trust store to disk (creating the directory if needed).
 *
 * @param store - The trust store to write
 */
export async function saveTrustStore(store: TrustStore): Promise<void> {
  const dir = getTrustStoreDir()
  await fs.ensureDir(dir)

  // Write atomically: write to a sibling temp file (0o600) and rename over the
  // target. rename() is atomic on the same filesystem, so a crash or concurrent
  // reader never sees a half-written trust store.
  const storePath = getTrustStorePath()
  const tmpPath = `${storePath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600 })
  await fs.rename(tmpPath, storePath)
}

/**
 * Check whether a config file is currently trusted with a matching content hash.
 *
 * @param filePath - Absolute path to the config file
 * @param currentHash - The file's current content hash
 * @returns True if a trust entry exists and its hash matches `currentHash`
 */
export async function isConfigTrusted(filePath: string, currentHash: string): Promise<boolean> {
  const store = await loadTrustStore()
  const entry = store.trusted[filePath]
  return Boolean(entry && entry.hash === currentHash)
}

/**
 * Record trust for a config file at a specific content hash.
 *
 * @param filePath - Absolute path to the config file
 * @param hash - The content hash to trust
 */
export async function recordTrust(filePath: string, hash: string): Promise<void> {
  const store = await loadTrustStore()
  store.version = TRUST_STORE_VERSION
  store.trusted[filePath] = {
    hash,
    trustedAt: new Date().toISOString(),
  }
  await saveTrustStore(store)
}
