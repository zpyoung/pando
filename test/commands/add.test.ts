import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddWorktree from '../../src/commands/add'
import type { WorktreeSetupOrchestrator } from '../../src/utils/worktreeSetup'
import type { PandoConfig } from '../../src/config/schema'

/**
 * Unit tests for the `add` command.
 *
 * These tests exercise the command's real logic by invoking it (or its private
 * methods) directly against a mocked GitHelper / config loader / trust utils —
 * the same style used by clean.test.ts and health.test.ts. They deliberately
 * avoid the full oclif runner so the assertions target business behavior
 * (validation, flag coordination, trust gating, interrupt rollback) rather than
 * hand-constructed data.
 */

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockGitHelper = {
  isRepository: vi.fn(),
  getRepositoryRoot: vi.fn(),
  getCurrentBranch: vi.fn(),
  branchExists: vi.fn(),
  addWorktree: vi.fn(),
  rebaseBranchInWorktree: vi.fn(),
}

vi.mock('../../src/utils/git.js', () => ({
  GitHelper: vi.fn(() => mockGitHelper),
  createGitHelper: vi.fn(() => mockGitHelper),
}))

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}))

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

// fs-extra is imported dynamically inside the command (`await import('fs-extra')`),
// so we replace the whole module rather than spying individual named exports
// (which ESM forbids redefining). Only the calls the command makes are stubbed.
vi.mock('fs-extra', () => {
  const mock = {
    pathExists: vi.fn().mockResolvedValue(false),
    ensureDir: vi.fn().mockResolvedValue(undefined),
  }
  return { ...mock, default: mock }
})

import { loadConfig } from '../../src/config/loader.js'
import {
  decidePostCommandTrust,
  isEnvTrustEnabled,
  isConfigTrusted,
  computeConfigHash,
} from '../../src/utils/configTrust.js'
import { normalizePostCommandScripts, runPostCommandScripts } from '../../src/utils/postCommands.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseConfig(overrides: Partial<PandoConfig> = {}): PandoConfig {
  return {
    rsync: { enabled: true, flags: ['--archive'], exclude: [] },
    symlink: { patterns: [], relative: true, beforeRsync: true },
    worktree: {
      rebaseOnAdd: true,
      deleteBranchOnRemove: 'local',
      useProjectSubfolder: false,
      targetBranch: 'main',
    },
    clean: { fetch: false },
    ...overrides,
  } as PandoConfig
}

/**
 * Build an AddWorktree instance with `error`/`warn`/`log` spies installed.
 * `error` throws (matching oclif's exit-on-error contract) so validation paths
 * stop execution exactly as they do at runtime.
 */
function createCommand(): {
  command: AddWorktree
  logSpy: ReturnType<typeof vi.spyOn>
  warnSpy: ReturnType<typeof vi.spyOn>
  errorSpy: ReturnType<typeof vi.spyOn>
} {
  const command = new AddWorktree([], { runHook: vi.fn() } as never)
  const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
  const warnSpy = vi.spyOn(command, 'warn').mockImplementation(((msg: string) => msg) as never)
  const errorSpy = vi.spyOn(command, 'error').mockImplementation(((msg: string | Error) => {
    throw new Error(typeof msg === 'string' ? msg : msg.message)
  }) as never)
  return { command, logSpy, warnSpy, errorSpy }
}

/**
 * Stub `command.parse(...)` so a `run()`-level test does not depend on oclif's
 * argv parsing internals. Mirrors health.test.ts's approach.
 */
function stubParse(
  command: AddWorktree,
  flags: Record<string, unknown>,
  args: Record<string, unknown> = {}
): void {
  vi.spyOn(command as unknown as { parse: () => Promise<unknown> }, 'parse').mockResolvedValue({
    flags,
    args,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Branch-name validation
// ---------------------------------------------------------------------------

describe('add: branch-name validation', () => {
  it('rejects an invalid branch name (positional arg) before doing any git work', async () => {
    const { command, errorSpy } = createCommand()
    // Invalid: contains a space, which git forbids in ref names. Supplied as the
    // positional `branch` arg (run() copies it into flags.branch).
    stubParse(command, { json: false }, { branch: 'bad branch name' })

    await expect(command.run()).rejects.toThrow(/Invalid branch name 'bad branch name'/)

    // The error message surfaces the underlying validation reason...
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('whitespace or control characters')

    // ...and we never reached git initialization.
    expect(mockGitHelper.isRepository).not.toHaveBeenCalled()
    expect(mockGitHelper.addWorktree).not.toHaveBeenCalled()
  })

  it('rejects an invalid --branch flag value the same way', async () => {
    const { command, errorSpy } = createCommand()
    stubParse(command, { branch: 'feature..bad', json: false })

    await expect(command.run()).rejects.toThrow(/Invalid branch name 'feature\.\.bad'/)
    expect(mockGitHelper.addWorktree).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls[0]?.[0]).toContain("cannot contain '..'")
  })

  it('emits the validation error as JSON when --json is set', async () => {
    const { command, logSpy, errorSpy } = createCommand()
    stubParse(command, { branch: 'bad~name', json: true })

    await expect(command.run()).rejects.toThrow()

    // In JSON mode ErrorHelper logs the structured payload instead of using error().
    expect(errorSpy).not.toHaveBeenCalled()
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain("Invalid branch name 'bad~name'")
  })

  it('accepts a valid branch name and proceeds to git initialization', async () => {
    const { command } = createCommand()
    // Fail fast right after validation by reporting "not a git repository".
    mockGitHelper.isRepository.mockResolvedValue(false)
    stubParse(command, { branch: 'valid-feature', json: true })

    await expect(command.run()).rejects.toThrow()

    // Validation passed, so we reached the repo check.
    expect(mockGitHelper.isRepository).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// validateAndInitialize: branch/commit conflict
// ---------------------------------------------------------------------------

// NOTE: validateAndInitialize internally calls createGitHelper() to obtain a
// GitHelper. These tests depend on the module-level `vi.mock('../../src/utils/git.js')`
// factory above returning the SAME `mockGitHelper` object every call — that's how
// `mockGitHelper.branchExists` assertions here observe the calls made inside
// validateAndInitialize. Keep the mock factory-based (returning the shared
// mockGitHelper); replacing it with a per-call/fresh mock would break these tests.
describe('add: validateAndInitialize branch/commit conflict', () => {
  it('rejects --branch + --commit when the branch already exists and --force is absent', async () => {
    const { command, errorSpy } = createCommand()
    mockGitHelper.branchExists.mockResolvedValue(true)

    const flags = {
      path: '/repo/../wt',
      branch: 'existing-branch',
      commit: 'abc1234',
      force: false,
      json: false,
    }

    await expect(
      (
        command as unknown as {
          validateAndInitialize: (
            f: Record<string, unknown>,
            s: null,
            c: PandoConfig,
            r: string
          ) => Promise<unknown>
        }
      ).validateAndInitialize(flags, null, baseConfig(), '/repo')
    ).rejects.toThrow(/already exists/)

    expect(mockGitHelper.branchExists).toHaveBeenCalledWith('existing-branch')
    const message = errorSpy.mock.calls[0]?.[0] as string
    expect(message).toContain("Branch 'existing-branch' already exists")
    expect(message).toContain('Use --force')
  })

  it('does NOT check branchExists when --force is set (force-reset is allowed)', async () => {
    const { command } = createCommand()
    mockGitHelper.branchExists.mockResolvedValue(true)

    const flags = {
      path: '/repo/../wt',
      branch: 'existing-branch',
      commit: 'abc1234',
      force: true,
      json: false,
    }

    const result = await (
      command as unknown as {
        validateAndInitialize: (
          f: Record<string, unknown>,
          s: null,
          c: PandoConfig,
          r: string
        ) => Promise<{ resolvedPath: string }>
      }
    ).validateAndInitialize(flags, null, baseConfig(), '/repo')

    // With --force, the existing-branch guard is skipped entirely.
    expect(mockGitHelper.branchExists).not.toHaveBeenCalled()
    expect(result.resolvedPath).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// loadAndMergeConfig: flag-consistency warning
// ---------------------------------------------------------------------------

describe('add: flag-consistency warnings', () => {
  it('warns when --skip-rsync is combined with --rsync-flags', async () => {
    const { command, warnSpy } = createCommand()
    vi.mocked(loadConfig).mockResolvedValue(baseConfig())
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')

    const flags = {
      'skip-rsync': true,
      'rsync-flags': ['--checksum'],
      json: false,
    }

    const config = await (
      command as unknown as {
        loadAndMergeConfig: (
          f: Record<string, unknown>,
          g: typeof mockGitHelper,
          s: null
        ) => Promise<PandoConfig>
      }
    ).loadAndMergeConfig(flags, mockGitHelper, null)

    // The warning fires (non-fatal) ...
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      '--rsync-flags and --rsync-exclude are ignored when --skip-rsync is set'
    )
    // ... and rsync is disabled because --skip-rsync wins.
    expect(config.rsync.enabled).toBe(false)
  })

  it('warns when --skip-rsync is combined with --rsync-exclude', async () => {
    const { command, warnSpy } = createCommand()
    vi.mocked(loadConfig).mockResolvedValue(baseConfig())
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')

    const flags = {
      'skip-rsync': true,
      'rsync-exclude': ['*.log'],
      json: false,
    }

    await (
      command as unknown as {
        loadAndMergeConfig: (
          f: Record<string, unknown>,
          g: typeof mockGitHelper,
          s: null
        ) => Promise<PandoConfig>
      }
    ).loadAndMergeConfig(flags, mockGitHelper, null)

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT warn when --skip-rsync is used alone', async () => {
    const { command, warnSpy } = createCommand()
    vi.mocked(loadConfig).mockResolvedValue(baseConfig())
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')

    const flags = { 'skip-rsync': true, json: false }

    const config = await (
      command as unknown as {
        loadAndMergeConfig: (
          f: Record<string, unknown>,
          g: typeof mockGitHelper,
          s: null
        ) => Promise<PandoConfig>
      }
    ).loadAndMergeConfig(flags, mockGitHelper, null)

    expect(warnSpy).not.toHaveBeenCalled()
    expect(config.rsync.enabled).toBe(false)
  })

  it('applies --rsync-flags as a comma-split override when rsync is enabled', async () => {
    const { command } = createCommand()
    vi.mocked(loadConfig).mockResolvedValue(baseConfig())
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')

    const flags = { 'rsync-flags': ['--verbose,--checksum'], json: false }

    const config = await (
      command as unknown as {
        loadAndMergeConfig: (
          f: Record<string, unknown>,
          g: typeof mockGitHelper,
          s: null
        ) => Promise<PandoConfig>
      }
    ).loadAndMergeConfig(flags, mockGitHelper, null)

    expect(config.rsync.flags).toEqual(['--verbose', '--checksum'])
  })
})

// ---------------------------------------------------------------------------
// Trust gate decision wiring (runPostCommands)
// ---------------------------------------------------------------------------

describe('add: post-command trust gate wiring', () => {
  const scripts = [{ command: 'echo hi' }]
  const worktreeInfo = { path: '/wt', branch: 'feature', commit: 'abc1234' }

  function callRunPostCommands(
    command: AddWorktree,
    config: PandoConfig,
    flags: Record<string, unknown>
  ): Promise<unknown> {
    return (
      command as unknown as {
        runPostCommands: (
          f: Record<string, unknown>,
          c: PandoConfig,
          w: typeof worktreeInfo,
          p: string,
          s: null
        ) => Promise<unknown>
      }
    ).runPostCommands(flags, config, worktreeInfo, '/wt', null)
  }

  it('runs post-commands when the trust decision is "run"', async () => {
    const { command } = createCommand()
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

    const config = baseConfig({
      postCommandsSourcePath: '/repo/.pando.toml',
    } as Partial<PandoConfig>)
    const result = await callRunPostCommands(command, config, { json: false })

    expect(decidePostCommandTrust).toHaveBeenCalledTimes(1)
    expect(runPostCommandScripts).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
  })

  it('skips post-commands (without running them) when the trust decision is "skip"', async () => {
    const { command, warnSpy } = createCommand()
    vi.mocked(normalizePostCommandScripts).mockReturnValue(scripts)
    vi.mocked(isEnvTrustEnabled).mockReturnValue(false)
    vi.mocked(computeConfigHash).mockResolvedValue('deadbeef')
    vi.mocked(isConfigTrusted).mockResolvedValue(false)
    vi.mocked(decidePostCommandTrust).mockReturnValue('skip')

    const config = baseConfig({
      postCommandsSourcePath: '/repo/.pando.toml',
    } as Partial<PandoConfig>)
    // Non-JSON mode → skip decision warns via command.warn and returns [].
    const result = await callRunPostCommands(command, config, { json: false })

    expect(decidePostCommandTrust).toHaveBeenCalledTimes(1)
    expect(runPostCommandScripts).not.toHaveBeenCalled()
    expect(result).toEqual([])
    // A warning explains how to trust the file.
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0]?.[0]).toContain('untrusted config file')
  })

  it('short-circuits without consulting the trust gate when there are no scripts', async () => {
    const { command } = createCommand()
    vi.mocked(normalizePostCommandScripts).mockReturnValue([])

    const result = await callRunPostCommands(command, baseConfig(), { json: false })

    expect(decidePostCommandTrust).not.toHaveBeenCalled()
    expect(runPostCommandScripts).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SIGINT interrupt handler (preserved from security work — DO NOT DELETE)
// ---------------------------------------------------------------------------

describe('add: SIGINT interrupt handler', () => {
  // The handler is extracted via createSetupInterruptHandler so it can be
  // invoked directly without sending a real signal.
  it('rolls back via the orchestrator and exits 130 on interrupt', async () => {
    const command = new AddWorktree([], { runHook: vi.fn() } as never)

    const rollback = vi.fn().mockResolvedValue({ rolledBack: true, warnings: [] })
    const fakeOrchestrator = { rollback } as unknown as WorktreeSetupOrchestrator

    const spinner = { stop: vi.fn(), start: vi.fn(), isSpinning: true } as never

    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as never)

    const handler = command.createSetupInterruptHandler(fakeOrchestrator, spinner)
    await handler()

    expect((spinner as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Interrupted'))
    expect(exitSpy).toHaveBeenCalledWith(130)

    logSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('still exits 130 even if rollback throws', async () => {
    const command = new AddWorktree([], { runHook: vi.fn() } as never)

    const rollback = vi.fn().mockRejectedValue(new Error('rollback boom'))
    const fakeOrchestrator = { rollback } as unknown as WorktreeSetupOrchestrator

    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as never)

    const handler = command.createSetupInterruptHandler(fakeOrchestrator, null)
    await handler()

    expect(rollback).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(130)

    logSpy.mockRestore()
    exitSpy.mockRestore()
  })
})
