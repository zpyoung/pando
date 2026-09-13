import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Command } from '@oclif/core'
import type { LoadedPandoConfig } from '../../src/config/loader'

vi.mock('../../src/utils/configTrust.js', () => ({
  computeConfigHash: vi.fn(),
  decidePostCommandTrust: vi.fn(),
  isConfigTrusted: vi.fn(),
  isEnvTrustEnabled: vi.fn(),
  recordTrust: vi.fn(),
}))

vi.mock('../../src/utils/postCommands.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/postCommands.js')>(
    '../../src/utils/postCommands.js'
  )
  return {
    ...actual,
    normalizePostCommandScripts: vi.fn(),
    runPostCommandScripts: vi.fn(),
  }
})

import { runTrustedPostCommands } from '../../src/utils/postCommandRunner'
import {
  computeConfigHash,
  decidePostCommandTrust,
  isConfigTrusted,
  isEnvTrustEnabled,
} from '../../src/utils/configTrust.js'
import { normalizePostCommandScripts, runPostCommandScripts } from '../../src/utils/postCommands.js'

const scripts = [{ command: 'echo hi' }]

function fakeCommand(): {
  command: Command
  logSpy: ReturnType<typeof vi.fn>
  warnSpy: ReturnType<typeof vi.fn>
} {
  const logSpy = vi.fn()
  const warnSpy = vi.fn()
  const command = { log: logSpy, warn: warnSpy } as unknown as Command
  return { command, logSpy, warnSpy }
}

function baseContext() {
  return {
    cwd: '/wt',
    worktreePath: '/wt',
    branch: 'feature',
    commit: 'abc1234',
    kind: 'long-lived' as const,
    ttl: undefined,
  }
}

describe('runTrustedPostCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs scripts when the trust decision is "run"', async () => {
    vi.mocked(normalizePostCommandScripts).mockReturnValue(scripts)
    vi.mocked(isEnvTrustEnabled).mockReturnValue(true)
    vi.mocked(decidePostCommandTrust).mockReturnValue('run')
    vi.mocked(runPostCommandScripts).mockResolvedValue([
      {
        name: null,
        command: 'echo hi',
        cwd: '/wt',
        exitCode: 0,
        signal: null,
        stdout: 'hi\n',
        stderr: '',
        success: true,
        duration: 1,
      },
    ])
    const { command } = fakeCommand()

    const result = await runTrustedPostCommands({
      command,
      config: { postCommandsSourcePath: '/repo/.pando.toml' } as LoadedPandoConfig,
      commandName: 'adopt',
      scriptKey: 'adopt',
      context: { ...baseContext(), ports: { web: 3100 }, dbName: 'dev_feature' },
      isJson: false,
      spinner: null,
      warnings: [],
    })

    expect(runPostCommandScripts).toHaveBeenCalledWith(scripts, {
      commandName: 'adopt',
      cwd: '/wt',
      worktreePath: '/wt',
      branch: 'feature',
      commit: 'abc1234',
      kind: 'long-lived',
      ttl: undefined,
      ports: { web: 3100 },
      dbName: 'dev_feature',
    })
    expect(result).toHaveLength(1)
  })

  it('skips (without running) when the trust decision is "skip" and warns', async () => {
    vi.mocked(normalizePostCommandScripts).mockReturnValue(scripts)
    vi.mocked(isEnvTrustEnabled).mockReturnValue(false)
    vi.mocked(computeConfigHash).mockResolvedValue('deadbeef')
    vi.mocked(isConfigTrusted).mockResolvedValue(false)
    vi.mocked(decidePostCommandTrust).mockReturnValue('skip')
    const { command, warnSpy } = fakeCommand()

    const result = await runTrustedPostCommands({
      command,
      config: { postCommandsSourcePath: '/repo/.pando.toml' } as LoadedPandoConfig,
      commandName: 'adopt',
      scriptKey: 'adopt',
      context: baseContext(),
      isJson: false,
      spinner: null,
      warnings: [],
    })

    expect(runPostCommandScripts).not.toHaveBeenCalled()
    expect(result).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0]?.[0]).toContain('untrusted config file')
    // The remediation hint references the running command, not a hard-coded 'add'.
    expect(warnSpy.mock.calls[0]?.[0]).toContain('pando adopt')
  })

  it('pushes the skip warning into warnings[] in JSON mode (no command.warn)', async () => {
    vi.mocked(normalizePostCommandScripts).mockReturnValue(scripts)
    vi.mocked(isEnvTrustEnabled).mockReturnValue(false)
    vi.mocked(computeConfigHash).mockResolvedValue('deadbeef')
    vi.mocked(isConfigTrusted).mockResolvedValue(false)
    vi.mocked(decidePostCommandTrust).mockReturnValue('skip')
    const { command, warnSpy } = fakeCommand()
    const warnings: string[] = []

    await runTrustedPostCommands({
      command,
      config: { postCommandsSourcePath: '/repo/.pando.toml' } as LoadedPandoConfig,
      commandName: 'adopt',
      scriptKey: 'adopt',
      context: baseContext(),
      isJson: true,
      spinner: null,
      warnings,
    })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(warnings.some((w) => w.includes('untrusted config file'))).toBe(true)
  })

  it('short-circuits without consulting the trust gate when there are no scripts', async () => {
    vi.mocked(normalizePostCommandScripts).mockReturnValue([])
    const { command } = fakeCommand()

    const result = await runTrustedPostCommands({
      command,
      config: {} as LoadedPandoConfig,
      commandName: 'adopt',
      scriptKey: 'adopt',
      context: baseContext(),
      isJson: false,
      spinner: null,
      warnings: [],
    })

    expect(decidePostCommandTrust).not.toHaveBeenCalled()
    expect(runPostCommandScripts).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('falls back to fallbackScriptKey when the primary key has no scripts', async () => {
    // adopt has no scripts configured; 'add' does — adopt should run them.
    vi.mocked(normalizePostCommandScripts).mockImplementation((_config, key) =>
      key === 'add' ? scripts : []
    )
    vi.mocked(isEnvTrustEnabled).mockReturnValue(true)
    vi.mocked(decidePostCommandTrust).mockReturnValue('run')
    vi.mocked(runPostCommandScripts).mockResolvedValue([])
    const { command } = fakeCommand()

    await runTrustedPostCommands({
      command,
      config: { postCommandsSourcePath: '/repo/.pando.toml' } as LoadedPandoConfig,
      commandName: 'adopt',
      scriptKey: 'adopt',
      fallbackScriptKey: 'add',
      context: baseContext(),
      isJson: false,
      spinner: null,
      warnings: [],
    })

    expect(normalizePostCommandScripts).toHaveBeenCalledWith(expect.anything(), 'adopt')
    expect(normalizePostCommandScripts).toHaveBeenCalledWith(expect.anything(), 'add')
    // Runs the fallback scripts, but still under the adopt command identity.
    expect(runPostCommandScripts).toHaveBeenCalledWith(
      scripts,
      expect.objectContaining({ commandName: 'adopt' })
    )
  })
})
