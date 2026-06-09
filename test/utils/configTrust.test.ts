import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  decidePostCommandTrust,
  isEnvTrustEnabled,
  hashConfigContent,
  computeConfigHash,
  isConfigTrusted,
  recordTrust,
  loadTrustStore,
  getTrustStorePath,
  TRUST_STORE_VERSION,
} from '../../src/utils/configTrust.js'

describe('configTrust', () => {
  describe('decidePostCommandTrust (pure decision function)', () => {
    const base = {
      hasScripts: true,
      sourcePath: '/repo/.pando.toml',
      envTrust: false,
      trustedWithMatchingHash: false,
      isTty: true,
      isJson: false,
    }

    it('skips when there are no scripts', () => {
      expect(decidePostCommandTrust({ ...base, hasScripts: false })).toBe('skip')
    })

    it('runs env-sourced post-commands (no source file) implicitly', () => {
      expect(decidePostCommandTrust({ ...base, sourcePath: undefined })).toBe('run')
    })

    it('runs when PANDO_TRUST_CONFIG escape hatch is set', () => {
      expect(decidePostCommandTrust({ ...base, envTrust: true })).toBe('run')
    })

    it('runs when file is trusted with matching hash', () => {
      expect(decidePostCommandTrust({ ...base, trustedWithMatchingHash: true })).toBe('run')
    })

    it('prompts when interactive TTY and not JSON and untrusted', () => {
      expect(decidePostCommandTrust(base)).toBe('prompt')
    })

    it('skips when not a TTY (non-interactive) and untrusted', () => {
      expect(decidePostCommandTrust({ ...base, isTty: false })).toBe('skip')
    })

    it('skips when JSON mode (never prompt for machine output)', () => {
      expect(decidePostCommandTrust({ ...base, isJson: true })).toBe('skip')
    })

    it('a changed hash (no longer matching) re-triggers a prompt', () => {
      // Simulate file that was trusted previously but now has a different hash:
      // trustedWithMatchingHash is false, interactive → prompt again.
      const result = decidePostCommandTrust({ ...base, trustedWithMatchingHash: false })
      expect(result).toBe('prompt')
    })

    it('env escape hatch wins even when not a TTY', () => {
      expect(decidePostCommandTrust({ ...base, envTrust: true, isTty: false })).toBe('run')
    })
  })

  describe('isEnvTrustEnabled', () => {
    it.each(['1', 'true', 'TRUE', ' true ', 'True'])('returns true for %j', (value) => {
      expect(isEnvTrustEnabled(value)).toBe(true)
    })

    it.each([undefined, '', '0', 'false', 'no', 'yes'])('returns false for %j', (value) => {
      expect(isEnvTrustEnabled(value)).toBe(false)
    })
  })

  describe('hashConfigContent', () => {
    it('produces a stable sha256 hex digest', () => {
      const hash = hashConfigContent('hello world')
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
    })

    it('produces different hashes for different content', () => {
      expect(hashConfigContent('a')).not.toBe(hashConfigContent('b'))
    })
  })

  describe('trust store (filesystem roundtrip)', () => {
    let tmpDir: string
    let originalXdg: string | undefined
    let originalHome: string | undefined

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-trust-test-'))
      originalXdg = process.env.XDG_CONFIG_HOME
      originalHome = process.env.HOME
      // Point the trust store at our temp dir via XDG_CONFIG_HOME.
      process.env.XDG_CONFIG_HOME = tmpDir
    })

    afterEach(async () => {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg
      }
      if (originalHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalHome
      }
      await fs.remove(tmpDir)
    })

    it('stores the trust file under XDG_CONFIG_HOME/pando/', () => {
      const storePath = getTrustStorePath()
      expect(storePath).toBe(path.join(tmpDir, 'pando', 'trusted-configs.json'))
    })

    it('returns an empty store when nothing is trusted yet', async () => {
      const store = await loadTrustStore()
      expect(store).toEqual({ version: TRUST_STORE_VERSION, trusted: {} })
    })

    it('records and reads back trust for a config file', async () => {
      const configPath = path.join(tmpDir, '.pando.toml')
      await fs.writeFile(configPath, '[postCommands]\nadd = ["echo hi"]\n')

      const hash = await computeConfigHash(configPath)
      expect(await isConfigTrusted(configPath, hash)).toBe(false)

      await recordTrust(configPath, hash)

      expect(await isConfigTrusted(configPath, hash)).toBe(true)

      const store = await loadTrustStore()
      expect(store.version).toBe(TRUST_STORE_VERSION)
      expect(store.trusted[configPath]?.hash).toBe(hash)
      expect(typeof store.trusted[configPath]?.trustedAt).toBe('string')
    })

    it('treats a changed file hash as no longer trusted (re-prompt)', async () => {
      const configPath = path.join(tmpDir, '.pando.toml')
      await fs.writeFile(configPath, 'original = true\n')
      const originalHash = await computeConfigHash(configPath)
      await recordTrust(configPath, originalHash)
      expect(await isConfigTrusted(configPath, originalHash)).toBe(true)

      // Mutate the file: its hash changes, so the stored trust no longer matches.
      await fs.writeFile(configPath, 'original = false\n# tampered\n')
      const newHash = await computeConfigHash(configPath)
      expect(newHash).not.toBe(originalHash)
      expect(await isConfigTrusted(configPath, newHash)).toBe(false)
    })

    it('does not crash on a corrupt trust store (treats as empty)', async () => {
      const storePath = getTrustStorePath()
      await fs.ensureDir(path.dirname(storePath))
      await fs.writeFile(storePath, '{ this is not valid json ')

      const store = await loadTrustStore()
      expect(store).toEqual({ version: TRUST_STORE_VERSION, trusted: {} })

      // Recording trust over a corrupt store should still work.
      await recordTrust('/some/config.toml', 'abc123')
      expect(await isConfigTrusted('/some/config.toml', 'abc123')).toBe(true)
    })

    it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
      delete process.env.XDG_CONFIG_HOME
      process.env.HOME = tmpDir
      const storePath = getTrustStorePath()
      expect(storePath).toBe(path.join(tmpDir, '.config', 'pando', 'trusted-configs.json'))
    })
  })
})
