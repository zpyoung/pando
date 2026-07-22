import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddWorktree, { resolveWorktreeKind, setupLifecycleMetadata } from '../../src/commands/add'
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
  setRetryConfig: vi.fn(),
  isRepository: vi.fn(),
  getRepositoryRoot: vi.fn(),
  getCurrentBranch: vi.fn(),
  getMainWorktreePath: vi.fn(),
  branchExists: vi.fn(),
  addWorktree: vi.fn(),
  rebaseBranchInWorktree: vi.fn(),
  getMainBranch: vi.fn(),
  inferOwner: vi.fn(),
  lockWorktree: vi.fn(),
}

vi.mock('../../src/utils/git.js', () => ({
  GitHelper: vi.fn(() => mockGitHelper),
  createGitHelper: vi.fn(() => mockGitHelper),
}))

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/utils/worktreeMetadata.js', () => ({
  assertGitVersion: vi.fn(),
  ensureWorktreeConfigEnabled: vi.fn(),
  writeMetadata: vi.fn(),
}))

vi.mock('../../src/utils/portAllocator.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/portAllocator.js')>(
    '../../src/utils/portAllocator.js'
  )
  return { ...actual, allocate: vi.fn() }
})

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
import {
  normalizePostCommandScripts,
  PostCommandError,
  runPostCommandScripts,
} from '../../src/utils/postCommands.js'
import {
  assertGitVersion,
  ensureWorktreeConfigEnabled,
  writeMetadata,
} from '../../src/utils/worktreeMetadata.js'
import { allocate } from '../../src/utils/portAllocator.js'

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
      defaultKind: 'auto',
      ephemeralTtl: '4h',
      autoLockActive: true,
    },
    clean: { fetch: false },
    concurrency: { retry: { maxAttempts: 5, baseMs: 100, capMs: 2000 } },
    ports: {
      enabled: false,
      range: '3100-3199',
      names: ['web'],
      dbStrategy: 'named',
      dbBaseName: 'dev',
    },
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
  vi.mocked(assertGitVersion).mockResolvedValue(undefined)
  vi.mocked(ensureWorktreeConfigEnabled).mockResolvedValue({ enabled: true, migrated: [] })
  vi.mocked(writeMetadata).mockResolvedValue(undefined)
  vi.mocked(allocate).mockResolvedValue({})
  mockGitHelper.getMainWorktreePath.mockResolvedValue('/repo')
})

// ---------------------------------------------------------------------------
// Branch-name validation
// ---------------------------------------------------------------------------

describe('add: lifecycle kind resolution', () => {
  const emptyEnv: NodeJS.ProcessEnv = {}

  it('registers mutually exclusive lifecycle flags', () => {
    expect(AddWorktree.flags.ephemeral.exclusive).toContain('long-lived')
    expect(AddWorktree.flags['long-lived'].exclusive).toContain('ephemeral')
    expect(AddWorktree.flags).toHaveProperty('ttl')
    expect(AddWorktree.flags).toHaveProperty('owner')
    expect(AddWorktree.flags).toHaveProperty('ports')
  })

  it('uses explicit flags before config and inference', () => {
    expect(resolveWorktreeKind({ ephemeral: true }, 'long-lived', '/repo/wt', emptyEnv)).toBe(
      'ephemeral'
    )
    expect(
      resolveWorktreeKind({ 'long-lived': true }, 'ephemeral', '/repo/.claude/worktrees/task', {
        CLAUDE_SESSION_ID: 'session',
      })
    ).toBe('long-lived')
  })

  it('uses a configured kind before automatic inference', () => {
    expect(resolveWorktreeKind({}, 'long-lived', '/repo/.claude/worktrees/task', emptyEnv)).toBe(
      'long-lived'
    )
    expect(resolveWorktreeKind({}, 'ephemeral', '/repo/wt', emptyEnv)).toBe('ephemeral')
  })

  it('infers ephemeral kind from Claude worktree paths and agent environment signals', () => {
    expect(resolveWorktreeKind({}, 'auto', '/repo/.claude/worktrees/task', emptyEnv)).toBe(
      'ephemeral'
    )
    expect(resolveWorktreeKind({}, 'auto', '/repo/wt', { CLAUDE_SESSION_ID: '' })).toBe('ephemeral')
    expect(resolveWorktreeKind({}, 'auto', '/repo/wt', { PANDO_SESSION: 'p1' })).toBe('ephemeral')
    expect(resolveWorktreeKind({}, 'auto', '/repo/wt', { PANDO_EPHEMERAL: 'YES' })).toBe(
      'ephemeral'
    )
    expect(resolveWorktreeKind({}, 'auto', '/repo/wt', emptyEnv)).toBe('long-lived')
  })

  it('parses PANDO_EPHEMERAL as a boolean', () => {
    for (const value of ['false', '0', 'no', 'FALSE', 'No']) {
      expect(resolveWorktreeKind({}, 'auto', '/repo/wt', { PANDO_EPHEMERAL: value })).toBe(
        'long-lived'
      )
    }
    for (const value of ['true', '1', 'yes', 'TRUE', 'Yes']) {
      expect(resolveWorktreeKind({}, 'auto', '/repo/wt', { PANDO_EPHEMERAL: value })).toBe(
        'ephemeral'
      )
    }
  })
})

describe('add: lifecycle metadata setup', () => {
  const dependencies = () => ({
    assertGitVersion: vi.fn().mockResolvedValue(undefined),
    ensureWorktreeConfigEnabled: vi.fn().mockResolvedValue({ enabled: true, migrated: [] }),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
    allocate: vi.fn().mockResolvedValue({}),
  })

  const worktreeConfig = {
    defaultKind: 'auto' as const,
    ephemeralTtl: '4h',
    autoLockActive: true,
  }
  const portsConfig = {
    enabled: false,
    range: '3100-3199',
    names: ['web'],
    dbStrategy: 'named' as const,
    dbBaseName: 'dev',
  }

  it('does not auto-lock for an explicit owner without an active session', async () => {
    const lockWorktree = vi.fn().mockResolvedValue(undefined)
    const deps = dependencies()
    const result = await setupLifecycleMetadata(
      {
        flags: { owner: 'manual-owner' },
        worktreeConfig,
        portsConfig,
        gitHelper: {
          inferOwner: vi.fn().mockReturnValue(''),
          getMainBranch: vi.fn().mockResolvedValue('main'),
          lockWorktree,
        },
        gitRoot: '/repo',
        mainRepoPath: '/repo',
        resolvedPath: '/repo/wt',
        sourceBranch: 'develop',
        worktreeBranch: 'feature',
        env: {},
        createdAt: '2026-07-22T12:00:00.000Z',
      },
      deps
    )

    expect(result).toMatchObject({ owner: 'manual-owner', locked: false })
    expect(deps.writeMetadata).toHaveBeenCalledWith('/repo/wt', {
      kind: 'long-lived',
      createdAt: '2026-07-22T12:00:00.000Z',
      sourceBranch: 'develop',
      owner: 'manual-owner',
    })
    expect(lockWorktree).not.toHaveBeenCalled()
  })

  it('auto-locks when an actual agent session is present and auto-lock is enabled', async () => {
    const lockWorktree = vi.fn().mockResolvedValue(undefined)
    const result = await setupLifecycleMetadata(
      {
        flags: { owner: 'agent-7' },
        worktreeConfig,
        portsConfig,
        gitHelper: {
          inferOwner: vi.fn().mockReturnValue('agent-7'),
          getMainBranch: vi.fn().mockResolvedValue('main'),
          lockWorktree,
        },
        gitRoot: '/repo',
        mainRepoPath: '/repo',
        resolvedPath: '/repo/wt',
        sourceBranch: 'develop',
        worktreeBranch: 'feature',
        env: { CLAUDE_SESSION_ID: '' },
      },
      dependencies()
    )

    expect(result).toMatchObject({ kind: 'ephemeral', owner: 'agent-7', locked: true })
    expect(lockWorktree).toHaveBeenCalledWith('/repo/wt', 'pando: active session agent-7')
  })

  it('allocates ports, derives a database name, and writes both when enabled', async () => {
    const deps = dependencies()
    deps.allocate.mockResolvedValue({ web: 3100, api: 3101 })

    const result = await setupLifecycleMetadata(
      {
        flags: {},
        worktreeConfig,
        portsConfig: {
          ...portsConfig,
          enabled: true,
          names: ['web', 'api'],
          dbBaseName: 'pando',
        },
        gitHelper: {
          inferOwner: vi.fn().mockReturnValue(''),
          getMainBranch: vi.fn().mockResolvedValue('main'),
          lockWorktree: vi.fn(),
        },
        gitRoot: '/repo',
        mainRepoPath: '/repo/main',
        resolvedPath: '/repo/wt',
        sourceBranch: 'main',
        worktreeBranch: 'Feature/Ports',
        env: {},
      },
      deps
    )

    expect(deps.allocate).toHaveBeenCalledWith('/repo/wt', {
      range: '3100-3199',
      names: ['web', 'api'],
      mainRepoPath: '/repo/main',
    })
    expect(deps.writeMetadata).toHaveBeenLastCalledWith('/repo/wt', {
      dbName: 'pando_feature_ports',
    })
    expect(result).toMatchObject({
      ports: { web: 3100, api: 3101 },
      dbName: 'pando_feature_ports',
      warnings: [],
    })
  })

  it('uses the path basename for a detached worktree database name', async () => {
    const deps = dependencies()

    const result = await setupLifecycleMetadata(
      {
        flags: {},
        worktreeConfig,
        portsConfig: { ...portsConfig, enabled: true },
        gitHelper: {
          inferOwner: vi.fn().mockReturnValue(''),
          getMainBranch: vi.fn().mockResolvedValue('main'),
          lockWorktree: vi.fn(),
        },
        gitRoot: '/repo',
        mainRepoPath: '/repo/main',
        resolvedPath: '/repo/worktrees/detached-preview',
        sourceBranch: 'develop',
        worktreeBranch: null,
        env: {},
      },
      deps
    )

    expect(result.dbName).toBe('dev_detached_preview')
    expect(deps.writeMetadata).toHaveBeenLastCalledWith('/repo/worktrees/detached-preview', {
      dbName: 'dev_detached_preview',
    })
  })

  it('does not allocate ports when allocation is disabled', async () => {
    const deps = dependencies()

    const result = await setupLifecycleMetadata(
      {
        flags: {},
        worktreeConfig,
        portsConfig,
        gitHelper: {
          inferOwner: vi.fn().mockReturnValue(''),
          getMainBranch: vi.fn().mockResolvedValue('main'),
          lockWorktree: vi.fn(),
        },
        gitRoot: '/repo',
        mainRepoPath: '/repo/main',
        resolvedPath: '/repo/wt',
        sourceBranch: 'main',
        worktreeBranch: 'feature',
        env: {},
      },
      deps
    )

    expect(deps.allocate).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('ports')
    expect(result).not.toHaveProperty('dbName')
  })

  it('keeps allocation failures non-fatal and warns about skipped names', async () => {
    const failedDeps = dependencies()
    failedDeps.allocate.mockRejectedValue(new Error('port metadata denied'))
    const exhaustedDeps = dependencies()
    exhaustedDeps.allocate.mockResolvedValue({ web: 3100 })
    const enabledPorts = { ...portsConfig, enabled: true, names: ['web', 'api'] }
    const options = {
      flags: {},
      worktreeConfig,
      portsConfig: enabledPorts,
      gitHelper: {
        inferOwner: vi.fn().mockReturnValue(''),
        getMainBranch: vi.fn().mockResolvedValue('main'),
        lockWorktree: vi.fn(),
      },
      gitRoot: '/repo',
      mainRepoPath: '/repo/main',
      resolvedPath: '/repo/wt',
      sourceBranch: 'main',
      worktreeBranch: 'main',
      env: {},
    }

    await expect(setupLifecycleMetadata(options, failedDeps)).resolves.toMatchObject({
      locked: false,
      warnings: [expect.stringContaining('port metadata denied')],
    })
    await expect(setupLifecycleMetadata(options, exhaustedDeps)).resolves.toMatchObject({
      ports: { web: 3100 },
      dbName: 'dev_main',
      warnings: [expect.stringContaining('api')],
    })
  })

  it('keeps lock failures non-fatal and reports the actual unlocked state', async () => {
    const lockWorktree = vi.fn().mockRejectedValue(new Error('lock denied'))
    await expect(
      setupLifecycleMetadata(
        {
          flags: { owner: 'agent-7' },
          worktreeConfig,
          portsConfig,
          gitHelper: {
            inferOwner: vi.fn().mockReturnValue('agent-7'),
            getMainBranch: vi.fn().mockResolvedValue('main'),
            lockWorktree,
          },
          gitRoot: '/repo',
          mainRepoPath: '/repo',
          resolvedPath: '/repo/wt',
          sourceBranch: 'develop',
          worktreeBranch: 'feature',
          env: { PANDO_SESSION: 'session-7' },
        },
        dependencies()
      )
    ).resolves.toMatchObject({
      owner: 'agent-7',
      locked: false,
      warnings: [expect.stringContaining('lock denied')],
    })
  })

  it('includes lifecycle metadata in the single JSON success result', () => {
    const { command, logSpy } = createCommand()
    const setupResult = {
      rsyncResult: undefined,
      symlinkResult: undefined,
      skipWorktreeResult: undefined,
      cleanTree: true,
      warnings: ['setup warning'],
      details: {},
    }

    ;(
      command as unknown as {
        formatOutput: (
          flags: Record<string, unknown>,
          worktree: Record<string, unknown>,
          setup: Record<string, unknown>,
          lifecycle: Record<string, unknown>,
          postCommands: unknown[],
          duration: number,
          chalk: null
        ) => void
      }
    ).formatOutput(
      { json: true },
      { path: '/repo/wt', branch: 'feature', commit: 'abc1234' },
      setupResult,
      {
        kind: 'ephemeral',
        owner: 'agent-7',
        ttl: '30m',
        effectiveTtl: '30m',
        ports: { web: 3100 },
        dbName: 'dev_feature',
        locked: true,
        notice: 'Enabled extensions.worktreeConfig (migrated: none)',
        warnings: ['metadata warning'],
      },
      [],
      10,
      null
    )

    expect(logSpy).toHaveBeenCalledTimes(1)
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.worktree).toMatchObject({
      path: '/repo/wt',
      kind: 'ephemeral',
      owner: 'agent-7',
      ttl: '30m',
      effectiveTtl: '30m',
      ports: { web: 3100 },
      dbName: 'dev_feature',
      locked: true,
    })
    expect(output.warnings).toEqual([
      'setup warning',
      'Enabled extensions.worktreeConfig (migrated: none)',
      'metadata warning',
    ])
  })

  it('keeps metadata failures non-fatal after worktree creation', async () => {
    const deps = dependencies()
    deps.writeMetadata.mockRejectedValue(new Error('config.worktree denied'))
    const lockWorktree = vi.fn().mockResolvedValue(undefined)

    await expect(
      setupLifecycleMetadata(
        {
          flags: { ephemeral: true, ttl: '30m' },
          worktreeConfig,
          portsConfig,
          gitHelper: {
            inferOwner: vi.fn().mockReturnValue('agent-7'),
            getMainBranch: vi.fn().mockResolvedValue('main'),
            lockWorktree,
          },
          gitRoot: '/repo',
          mainRepoPath: '/repo',
          resolvedPath: '/repo/wt',
          sourceBranch: 'develop',
          worktreeBranch: 'feature',
          env: {},
        },
        deps
      )
    ).resolves.toMatchObject({
      kind: 'ephemeral',
      owner: 'agent-7',
      ttl: '30m',
      effectiveTtl: '30m',
      locked: false,
      warnings: [expect.stringContaining('config.worktree denied')],
    })
    expect(lockWorktree).not.toHaveBeenCalled()
  })
})

describe('add: JSON document consistency', () => {
  const setupResult = {
    rsyncResult: undefined,
    symlinkResult: undefined,
    skipWorktreeResult: undefined,
    cleanTree: true,
    warnings: ['setup warning'],
    details: {},
  }

  function prepareRun(command: AddWorktree, config: PandoConfig): void {
    vi.mocked(loadConfig).mockResolvedValue(config)
    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')
    mockGitHelper.getCurrentBranch.mockResolvedValue('main')
    mockGitHelper.addWorktree.mockResolvedValue({
      path: '/repo/wt',
      branch: 'feature',
      commit: 'abc1234',
      isExistingBranch: false,
    })
    mockGitHelper.inferOwner.mockReturnValue('')

    const internals = command as unknown as {
      runSetup: () => Promise<unknown>
    }
    vi.spyOn(internals, 'runSetup').mockResolvedValue(setupResult)
  }

  it('emits one parseable JSON document with flag, trust, and lifecycle warnings', async () => {
    const { command, logSpy, warnSpy } = createCommand()
    stubParse(command, {
      path: '/repo/wt',
      branch: 'feature',
      ephemeral: true,
      owner: 'agent-7',
      ttl: '30m',
      'skip-rsync': true,
      'rsync-flags': ['--checksum'],
      json: true,
    })
    prepareRun(
      command,
      baseConfig({
        postCommands: { add: ['echo hi'] },
        postCommandsSourcePath: '/repo/.pando.toml',
      } as Partial<PandoConfig>)
    )
    vi.mocked(ensureWorktreeConfigEnabled).mockResolvedValue({
      enabled: true,
      migrated: [],
      notice: 'Enabled extensions.worktreeConfig (migrated: none)',
    })
    vi.mocked(writeMetadata).mockRejectedValue(new Error('metadata denied'))
    vi.mocked(normalizePostCommandScripts).mockReturnValue([{ command: 'echo hi' }])
    vi.mocked(isEnvTrustEnabled).mockReturnValue(false)
    vi.mocked(computeConfigHash).mockResolvedValue('deadbeef')
    vi.mocked(isConfigTrusted).mockResolvedValue(false)
    vi.mocked(decidePostCommandTrust).mockReturnValue('skip')

    await command.run()

    expect(warnSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.success).toBe(true)
    expect(output.worktree).toMatchObject({
      kind: 'ephemeral',
      owner: 'agent-7',
      ttl: '30m',
      effectiveTtl: '30m',
      locked: false,
    })
    expect(output.warnings).toEqual(
      expect.arrayContaining([
        'setup warning',
        '--rsync-flags and --rsync-exclude are ignored when --skip-rsync is set',
        expect.stringContaining('untrusted config file'),
        'Enabled extensions.worktreeConfig (migrated: none)',
        expect.stringContaining('metadata denied'),
      ])
    )
  })

  it('keeps --ports allocation failures non-fatal in the command result', async () => {
    const { command, logSpy, warnSpy } = createCommand()
    stubParse(command, {
      path: '/repo/wt',
      branch: 'feature',
      ports: true,
      json: true,
    })
    prepareRun(command, baseConfig())
    vi.mocked(allocate).mockRejectedValue(new Error('allocator unavailable'))
    vi.mocked(normalizePostCommandScripts).mockReturnValue([])

    await command.run()

    expect(warnSpy).not.toHaveBeenCalled()
    expect(mockGitHelper.getMainWorktreePath).toHaveBeenCalledTimes(1)
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.success).toBe(true)
    expect(output.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('allocator unavailable')])
    )
  })

  it('retains lifecycle fields and warnings when a post-command fails', async () => {
    const { command, logSpy, warnSpy } = createCommand()
    stubParse(command, {
      path: '/repo/wt',
      branch: 'feature',
      ephemeral: true,
      owner: 'agent-7',
      ttl: '30m',
      json: true,
    })
    prepareRun(
      command,
      baseConfig({
        ports: {
          enabled: true,
          range: '3100-3199',
          names: ['web'],
          dbStrategy: 'named',
          dbBaseName: 'dev',
        },
      })
    )
    vi.mocked(allocate).mockResolvedValue({ web: 3100 })
    vi.mocked(ensureWorktreeConfigEnabled).mockResolvedValue({
      enabled: true,
      migrated: [],
      notice: 'lifecycle notice',
    })

    const failedResult = {
      name: 'failing-script',
      command: 'exit 2',
      cwd: '/repo/wt',
      exitCode: 2,
      signal: null,
      stdout: '',
      stderr: 'failed',
      success: false,
      duration: 1,
    }
    const internals = command as unknown as {
      runPostCommands: () => Promise<unknown>
    }
    vi.spyOn(internals, 'runPostCommands').mockRejectedValue(
      new PostCommandError('Post-command script failed: exit 2', failedResult, [failedResult])
    )

    await expect(command.run()).rejects.toThrow()

    expect(warnSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.success).toBe(false)
    expect(output.worktree).toMatchObject({
      path: '/repo/wt',
      kind: 'ephemeral',
      owner: 'agent-7',
      ttl: '30m',
      effectiveTtl: '30m',
      ports: { web: 3100 },
      dbName: 'dev_feature',
      locked: false,
    })
    expect(output.warnings).toEqual(['setup warning', 'lifecycle notice'])
    expect(output.failedPostCommand).toEqual(failedResult)
  })
})

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
    flags: Record<string, unknown>,
    resources: { ports?: Record<string, number>; dbName?: string } = {}
  ): Promise<unknown> {
    return (
      command as unknown as {
        runPostCommands: (
          f: Record<string, unknown>,
          c: PandoConfig,
          w: typeof worktreeInfo,
          p: string,
          s: null,
          k: 'ephemeral' | 'long-lived',
          t?: string,
          ports?: Record<string, number>,
          dbName?: string
        ) => Promise<unknown>
      }
    ).runPostCommands(
      flags,
      config,
      worktreeInfo,
      '/wt',
      null,
      'ephemeral',
      '4h',
      resources.ports,
      resources.dbName
    )
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
    const result = await callRunPostCommands(
      command,
      config,
      { json: false },
      { ports: { web: 3100 }, dbName: 'dev_feature' }
    )

    expect(decidePostCommandTrust).toHaveBeenCalledTimes(1)
    expect(runPostCommandScripts).toHaveBeenCalledTimes(1)
    expect(runPostCommandScripts).toHaveBeenCalledWith(scripts, {
      commandName: 'add',
      cwd: '/wt',
      worktreePath: '/wt',
      branch: 'feature',
      commit: 'abc1234',
      kind: 'ephemeral',
      ttl: '4h',
      ports: { web: 3100 },
      dbName: 'dev_feature',
    })
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
