import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdoptWorktree, { resolveAdoptKind } from '../../src/commands/adopt'
import type { PandoConfig } from '../../src/config/schema'
import type { SetupResult } from '../../src/utils/worktreeSetup'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockGitHelper = {
  setRetryConfig: vi.fn(),
  isRepository: vi.fn(),
  getRepositoryRoot: vi.fn(),
  getWorktreeByPath: vi.fn(),
  getDirtyPaths: vi.fn(),
  getMainWorktreePath: vi.fn(),
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
  readMetadata: vi.fn(),
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

vi.mock('../../src/utils/worktreeSetup.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/worktreeSetup.js')>(
    '../../src/utils/worktreeSetup.js'
  )
  return { ...actual, createWorktreeSetupOrchestrator: vi.fn() }
})

vi.mock('../../src/utils/postCommandRunner.js', () => ({
  runTrustedPostCommands: vi.fn(),
}))

import { loadConfig } from '../../src/config/loader.js'
import {
  readMetadata,
  assertGitVersion,
  ensureWorktreeConfigEnabled,
  writeMetadata,
} from '../../src/utils/worktreeMetadata.js'
import { createWorktreeSetupOrchestrator } from '../../src/utils/worktreeSetup.js'
import { runTrustedPostCommands } from '../../src/utils/postCommandRunner.js'

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
    reap: {},
    postCommands: {},
    ...overrides,
  } as PandoConfig
}

function setupResult(overrides: Partial<SetupResult> = {}): SetupResult {
  return {
    success: true,
    rsyncResult: {
      success: true,
      filesTransferred: 2,
      bytesSent: 0,
      totalSize: 1024,
      duration: 1,
    } as never,
    symlinkResult: { success: true, created: 1, skipped: 0, conflicts: [] },
    skipWorktreeResult: { filesMarked: 0, success: true },
    cleanTree: true,
    duration: 1,
    warnings: [],
    rolledBack: false,
    plan: {
      symlinks: { toCreate: ['x'], alreadyLinked: [], conflicts: [] },
      rsyncFileCount: 2,
      rsyncMode: 'untracked',
    },
    ...overrides,
  }
}

function createCommand(): {
  command: AdoptWorktree
  logSpy: ReturnType<typeof vi.spyOn>
  warnSpy: ReturnType<typeof vi.spyOn>
  errorSpy: ReturnType<typeof vi.spyOn>
} {
  const command = new AdoptWorktree([], { runHook: vi.fn() } as never)
  const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
  const warnSpy = vi.spyOn(command, 'warn').mockImplementation(((msg: string) => msg) as never)
  const errorSpy = vi.spyOn(command, 'error').mockImplementation(((msg: string | Error) => {
    throw new Error(typeof msg === 'string' ? msg : msg.message)
  }) as never)
  vi.spyOn(command as unknown as { exit: (n?: number) => void }, 'exit').mockImplementation(((
    code?: number
  ) => {
    throw new Error(`exit:${code ?? 0}`)
  }) as never)
  return { command, logSpy, warnSpy, errorSpy }
}

function stubParse(
  command: AdoptWorktree,
  flags: Record<string, unknown>,
  args: Record<string, unknown> = {}
): void {
  vi.spyOn(command as unknown as { parse: () => Promise<unknown> }, 'parse').mockResolvedValue({
    flags,
    args,
  } as never)
}

const mockOrchestrator = {
  setupNewWorktree: vi.fn(),
  rollback: vi.fn(),
  getTransaction: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertGitVersion).mockResolvedValue(undefined)
  vi.mocked(ensureWorktreeConfigEnabled).mockResolvedValue({ enabled: true, migrated: [] })
  vi.mocked(writeMetadata).mockResolvedValue(undefined)
  vi.mocked(readMetadata).mockResolvedValue({})
  vi.mocked(runTrustedPostCommands).mockResolvedValue([])
  mockGitHelper.isRepository.mockResolvedValue(true)
  mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')
  mockGitHelper.getDirtyPaths.mockResolvedValue([])
  mockGitHelper.getMainWorktreePath.mockResolvedValue('/repo')
  mockGitHelper.getMainBranch.mockResolvedValue('main')
  mockGitHelper.inferOwner.mockReturnValue('')
  mockGitHelper.lockWorktree.mockResolvedValue(undefined)
  mockOrchestrator.setupNewWorktree.mockResolvedValue(setupResult())
  mockOrchestrator.rollback.mockResolvedValue({ rolledBack: true, warnings: [] })
  vi.mocked(createWorktreeSetupOrchestrator).mockReturnValue(mockOrchestrator as never)
  vi.mocked(loadConfig).mockResolvedValue(baseConfig() as never)
})

const linkedWorktree = {
  info: { path: '/repo/feature', branch: 'feature', commit: 'abc1234', isPrunable: false },
  isMain: false,
}

// ---------------------------------------------------------------------------
// resolveAdoptKind
// ---------------------------------------------------------------------------

describe('resolveAdoptKind', () => {
  it('defaults to long-lived', () => {
    expect(resolveAdoptKind({})).toBe('long-lived')
  })
  it('honors explicit --ephemeral', () => {
    expect(resolveAdoptKind({ ephemeral: true })).toBe('ephemeral')
  })
  it('honors explicit --long-lived', () => {
    expect(resolveAdoptKind({ 'long-lived': true })).toBe('long-lived')
  })
  it('registers mutually exclusive lifecycle flags', () => {
    expect(AdoptWorktree.flags.ephemeral.exclusive).toContain('long-lived')
    expect(AdoptWorktree.flags['long-lived'].exclusive).toContain('ephemeral')
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('adopt: validation', () => {
  it('errors when not in a git repository', async () => {
    const { command, errorSpy } = createCommand()
    stubParse(command, { json: false })
    mockGitHelper.isRepository.mockResolvedValue(false)

    await expect(command.run()).rejects.toThrow(/Not a git repository/)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('errors when the target is not a linked worktree', async () => {
    const { command, errorSpy } = createCommand()
    stubParse(command, { json: false }, { path: '/some/dir' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(null)

    await expect(command.run()).rejects.toThrow(/is not a linked worktree/)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('errors when adopting the main worktree', async () => {
    const { command, errorSpy } = createCommand()
    stubParse(command, { json: false }, { path: '/repo' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue({
      info: { path: '/repo', branch: 'main', commit: 'abc', isPrunable: false },
      isMain: true,
    })

    await expect(command.run()).rejects.toThrow(/Cannot adopt the main worktree/)
    expect(errorSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

describe('adopt: apply', () => {
  it('runs setup in adopt mode and reports success (JSON)', async () => {
    const { command, logSpy } = createCommand()
    stubParse(command, { json: true }, { path: '/repo/feature' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(linkedWorktree)

    await command.run()

    // Orchestrator invoked in adopt mode against the canonical worktree path.
    const [calledPath, opts] = mockOrchestrator.setupNewWorktree.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(calledPath).toBe('/repo/feature')
    expect(opts).toMatchObject({ adopt: true, preexistingDirtyPaths: [] })

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.success).toBe(true)
    expect(output.adopted).toBe(true)
    expect(output.worktree).toMatchObject({ path: '/repo/feature', kind: 'long-lived' })
    expect(runTrustedPostCommands).toHaveBeenCalledTimes(1)
  })

  it('writes long-lived metadata with sourceBranch = config targetBranch', async () => {
    const { command } = createCommand()
    stubParse(command, { json: true }, { path: '/repo/feature' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(linkedWorktree)
    vi.mocked(loadConfig).mockResolvedValue(
      baseConfig({ worktree: { ...baseConfig().worktree, targetBranch: 'develop' } }) as never
    )

    await command.run()

    expect(writeMetadata).toHaveBeenCalledWith(
      '/repo/feature',
      expect.objectContaining({ kind: 'long-lived', sourceBranch: 'develop' })
    )
  })

  it('re-adopt preserves existing kind, createdAt, and sourceBranch (no silent rewrite)', async () => {
    const { command } = createCommand()
    stubParse(command, { json: true }, { path: '/repo/feature' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(linkedWorktree)
    vi.mocked(readMetadata).mockResolvedValue({
      kind: 'ephemeral',
      createdAt: '2020-01-01T00:00:00.000Z',
      sourceBranch: 'develop',
    })

    await command.run()

    // An ephemeral worktree must NOT be silently rewritten to long-lived, and its
    // age (createdAt) and sourceBranch must be preserved.
    expect(writeMetadata).toHaveBeenCalledWith(
      '/repo/feature',
      expect.objectContaining({
        kind: 'ephemeral',
        createdAt: '2020-01-01T00:00:00.000Z',
        sourceBranch: 'develop',
      })
    )
  })

  it('an explicit lifecycle flag still overrides a preserved kind on re-adopt', async () => {
    const { command } = createCommand()
    stubParse(command, { json: true, 'long-lived': true }, { path: '/repo/feature' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(linkedWorktree)
    vi.mocked(readMetadata).mockResolvedValue({
      kind: 'ephemeral',
      createdAt: '2020-01-01T00:00:00.000Z',
      sourceBranch: 'develop',
    })

    await command.run()

    expect(writeMetadata).toHaveBeenCalledWith(
      '/repo/feature',
      expect.objectContaining({ kind: 'long-lived' })
    )
  })

  it('passes pre-existing dirty paths to setup and reports them', async () => {
    const { command, logSpy } = createCommand()
    stubParse(command, { json: true }, { path: '/repo/feature' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(linkedWorktree)
    mockGitHelper.getDirtyPaths.mockResolvedValue(['src/wip.ts'])

    await command.run()

    const [, opts] = mockOrchestrator.setupNewWorktree.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(opts.preexistingDirtyPaths).toEqual(['src/wip.ts'])
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.preexistingDirty).toEqual(['src/wip.ts'])
  })

  it('re-applies for an already-managed worktree (idempotent) and flags it', async () => {
    const { command, logSpy } = createCommand()
    stubParse(command, { json: true }, { path: '/repo/feature' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(linkedWorktree)
    vi.mocked(readMetadata).mockResolvedValue({ kind: 'long-lived' })

    await command.run()

    expect(mockOrchestrator.setupNewWorktree).toHaveBeenCalledTimes(1)
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.alreadyManaged).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

describe('adopt: dry run', () => {
  it('emits the plan and skips lifecycle + post-commands', async () => {
    const { command, logSpy } = createCommand()
    stubParse(command, { json: true, 'dry-run': true }, { path: '/repo/feature' })
    mockGitHelper.getWorktreeByPath.mockResolvedValue(linkedWorktree)
    mockOrchestrator.setupNewWorktree.mockResolvedValue(
      setupResult({
        plan: {
          symlinks: { toCreate: ['a'], alreadyLinked: ['b'], conflicts: ['c'] },
          rsyncFileCount: 3,
          rsyncMode: 'untracked',
        },
      })
    )

    await command.run()

    const [, opts] = mockOrchestrator.setupNewWorktree.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(opts.dryRun).toBe(true)

    // No side effects: metadata + post-commands are not invoked in a dry run.
    expect(writeMetadata).not.toHaveBeenCalled()
    expect(runTrustedPostCommands).not.toHaveBeenCalled()

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.dryRun).toBe(true)
    expect(output.plan.symlinks.toCreate).toEqual(['a'])
    expect(output.plan.symlinks.conflicts).toEqual(['c'])
    expect(output.wouldWrite).toMatchObject({ kind: 'long-lived', sourceBranch: 'main' })
  })
})
