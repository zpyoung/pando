import { describe, it, expect, vi, beforeEach } from 'vitest'
import Health from '../../src/commands/health'
import { createGitHelper } from '../../src/utils/git'
import { ErrorHelper } from '../../src/utils/errors'
import { readMetadata } from '../../src/utils/worktreeMetadata'

// Mock the dependencies
vi.mock('../../src/utils/git')
vi.mock('../../src/utils/errors')
vi.mock('../../src/utils/worktreeMetadata', () => ({
  readMetadata: vi.fn(),
}))
vi.mock('chalk', () => ({
  default: {
    bold: (str: string) => `**${str}**`,
    red: (str: string) => `<red>${str}</red>`,
    yellow: (str: string) => `<yellow>${str}</yellow>`,
    green: (str: string) => `<green>${str}</green>`,
    cyan: (str: string) => `<cyan>${str}</cyan>`,
    gray: (str: string) => `<gray>${str}</gray>`,
    magenta: (str: string) => `<magenta>${str}</magenta>`,
    redBright: (str: string) => `<redBright>${str}</redBright>`,
    blue: (str: string) => `<blue>${str}</blue>`,
  },
}))

type MockFn = ReturnType<typeof vi.fn>

type MockGitHelper = {
  isRepository: MockFn
  listWorktrees: MockFn
  hasUncommittedChanges: MockFn
  getUncommittedFileCount: MockFn
  getTrackingBranch: MockFn
  remoteBranchExists: MockFn
  countCommitsBetween: MockFn
  getWorktreeAgeMs: MockFn
}

describe('Health Command', () => {
  let mockGitHelper: MockGitHelper
  let mockErrorHelper: {
    validation: MockFn
    operation: MockFn
  }

  const createCommand = (json = false): Health => {
    const command = new Health(json ? ['--json'] : [], {} as any)
    vi.spyOn(command as any, 'parse').mockResolvedValue({
      flags: { json },
      args: {},
    } as any)
    command.log = vi.fn()
    return command
  }

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Setup mock GitHelper
    mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      getUncommittedFileCount: vi.fn(),
      getTrackingBranch: vi.fn().mockResolvedValue(null),
      remoteBranchExists: vi.fn(),
      countCommitsBetween: vi.fn(),
      getWorktreeAgeMs: vi.fn().mockResolvedValue(60_000),
    }
    vi.mocked(readMetadata).mockResolvedValue({})

    mockErrorHelper = {
      validation: vi.fn(),
      operation: vi.fn(),
    }

    vi.mocked(createGitHelper).mockReturnValue(mockGitHelper as any)
    vi.mocked(ErrorHelper.validation).mockImplementation(((...args: any[]) => {
      mockErrorHelper.validation(...args)
    }) as never)
    vi.mocked(ErrorHelper.operation).mockImplementation(((...args: any[]) => {
      mockErrorHelper.operation(...args)
    }) as never)
  })

  it('should validate that current directory is a git repository', async () => {
    mockGitHelper.isRepository.mockResolvedValue(false)

    const command = createCommand()

    await command.run()

    expect(mockErrorHelper.validation).toHaveBeenCalled()
    expect(mockErrorHelper.validation).toHaveBeenCalledWith(
      expect.anything(),
      'Not a git repository. Run this command from within a git repository.',
      false
    )
  })

  it('should show empty state when no worktrees exist', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([])

    const command = createCommand()

    await command.run()

    expect(command.log).toHaveBeenCalledWith('<yellow>No worktrees found</yellow>')
  })

  it('should detect uncommitted changes in worktrees', async () => {
    vi.mocked(readMetadata).mockResolvedValue({ kind: 'ephemeral' })
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/auth',
        commit: 'abc123',
        isPrunable: false,
        isLocked: true,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(true)
    mockGitHelper.getUncommittedFileCount.mockResolvedValue(2)

    const command = createCommand()

    await command.run()

    expect(mockGitHelper.hasUncommittedChanges).toHaveBeenCalledWith('/worktree1')
    expect(mockGitHelper.getUncommittedFileCount).toHaveBeenCalledWith('/worktree1')
    expect(command.log).toHaveBeenCalledWith(expect.stringContaining('2 files modified'))
    expect(command.log).toHaveBeenCalledWith(
      expect.stringContaining('Lifecycle: ephemeral, locked')
    )
  })

  it('should detect branches behind upstream', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/fix',
        commit: 'abc123',
        isPrunable: false,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.getTrackingBranch.mockResolvedValue('origin/feature/fix')
    mockGitHelper.remoteBranchExists.mockResolvedValue(true)
    mockGitHelper.countCommitsBetween.mockResolvedValue(3)

    const command = createCommand(true)

    await command.run()

    expect(mockGitHelper.getTrackingBranch).toHaveBeenCalledWith('feature/fix')
    expect(mockGitHelper.remoteBranchExists).toHaveBeenCalledWith('feature/fix', 'origin')
    // Local branch must be first, tracking ref second, so this counts commits
    // the upstream has that the local branch lacks (i.e. how far behind).
    expect(mockGitHelper.countCommitsBetween).toHaveBeenCalledWith(
      'feature/fix',
      'origin/feature/fix'
    )

    const report = JSON.parse((command.log as any).mock.calls[0][0])
    expect(report.summary.behind).toBe(1)
    expect(report.worktrees[0]).toMatchObject({
      path: '/worktree1',
      branch: 'feature/fix',
      status: 'behind',
      message: '3 commits behind',
      details: {
        commitsBehind: 3,
        targetBranch: 'origin/feature/fix',
        remoteBranch: 'origin/feature/fix',
      },
    })
  })

  it('should detect behind upstream for non-origin remotes', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/fix',
        commit: 'abc123',
        isPrunable: false,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.getTrackingBranch.mockResolvedValue('upstream/main')
    mockGitHelper.remoteBranchExists.mockResolvedValue(true)
    mockGitHelper.countCommitsBetween.mockResolvedValue(1)

    const command = createCommand(true)

    await command.run()

    expect(mockGitHelper.remoteBranchExists).toHaveBeenCalledWith('main', 'upstream')
    const report = JSON.parse((command.log as any).mock.calls[0][0])
    expect(report.worktrees[0].status).toBe('behind')
    expect(report.worktrees[0].message).toBe('1 commit behind')
  })

  it('should report clean when no upstream is configured', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/local-only',
        commit: 'abc123',
        isPrunable: false,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.getTrackingBranch.mockResolvedValue(null)

    const command = createCommand(true)

    await command.run()

    expect(mockGitHelper.remoteBranchExists).not.toHaveBeenCalled()
    const report = JSON.parse((command.log as any).mock.calls[0][0])
    expect(report.summary.clean).toBe(1)
    expect(report.worktrees[0].status).toBe('clean')
  })

  it('should detect gone remote branches', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/old',
        commit: 'abc123',
        isPrunable: false,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.getTrackingBranch.mockResolvedValue('origin/feature/old')
    mockGitHelper.remoteBranchExists.mockResolvedValue(false)

    const command = createCommand(true)

    await command.run()

    expect(mockGitHelper.remoteBranchExists).toHaveBeenCalledWith('feature/old', 'origin')
    const report = JSON.parse((command.log as any).mock.calls[0][0])
    expect(report.summary.gone).toBe(1)
    expect(report.worktrees[0]).toMatchObject({
      status: 'gone',
      message: 'remote branch deleted',
      details: { remoteBranch: 'origin/feature/old' },
    })
  })

  it('should mark worktree as error when remote check fails', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/fix',
        commit: 'abc123',
        isPrunable: false,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.getTrackingBranch.mockResolvedValue('origin/feature/fix')
    mockGitHelper.remoteBranchExists.mockRejectedValue(new Error('network unreachable'))

    const command = createCommand(true)

    await command.run()

    const report = JSON.parse((command.log as any).mock.calls[0][0])
    expect(report.summary.errors).toBe(1)
    expect(report.summary.clean).toBe(0)
    expect(report.worktrees[0].status).toBe('error')
    expect(report.worktrees[0].message).toContain('remote check failed')
    expect(report.worktrees[0].message).toContain('network unreachable')
  })

  it('should report detached HEAD worktrees as detached, not clean', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: null,
        commit: 'abc123',
        isPrunable: false,
      },
    ])

    const command = createCommand(true)

    await command.run()

    expect(mockGitHelper.hasUncommittedChanges).not.toHaveBeenCalled()
    const report = JSON.parse((command.log as any).mock.calls[0][0])
    expect(report.summary.detached).toBe(1)
    expect(report.summary.clean).toBe(0)
    expect(report.worktrees[0]).toMatchObject({
      path: '/worktree1',
      branch: null,
      status: 'detached',
      message: 'detached HEAD',
    })
  })

  it('should output JSON format when --json flag is used', async () => {
    vi.mocked(readMetadata).mockResolvedValue({
      kind: 'ephemeral',
      owner: 'agent-7',
      ttl: '4h',
    })
    mockGitHelper.getWorktreeAgeMs.mockResolvedValue(3_600_000)
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/auth',
        commit: 'abc123',
        isPrunable: false,
        isLocked: true,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.getTrackingBranch.mockResolvedValue(null)

    const command = createCommand(true)

    await command.run()

    expect(command.log).toHaveBeenCalled()
    const logged = (command.log as any).mock.calls[0][0]
    const report = JSON.parse(logged)
    expect(report).toHaveProperty('worktrees')
    expect(report).toHaveProperty('summary')
    expect(report.summary).toEqual({
      clean: 1,
      detached: 0,
      uncommitted: 0,
      behind: 0,
      gone: 0,
      errors: 0,
    })
    expect(report.worktrees[0]).toMatchObject({
      status: 'clean',
      kind: 'ephemeral',
      ageMs: 3_600_000,
      ttl: '4h',
      locked: true,
      owner: 'agent-7',
    })
  })

  it('should handle errors gracefully', async () => {
    mockGitHelper.listWorktrees.mockRejectedValue(new Error('Git error'))

    const command = createCommand()

    await command.run()

    expect(mockErrorHelper.operation).toHaveBeenCalled()
    expect(mockErrorHelper.operation).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Error),
      'Failed to check worktree health',
      false
    )
  })
})
