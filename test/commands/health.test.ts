import { describe, it, expect, vi, beforeEach } from 'vitest'
import Health from '../../src/commands/health'
import { createGitHelper } from '../../src/utils/git'
import { ErrorHelper } from '../../src/utils/errors'

const mockSimpleGitStatus = vi.fn()

// Mock the dependencies
vi.mock('../../src/utils/git')
vi.mock('../../src/utils/errors')
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    status: mockSimpleGitStatus,
  })),
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
  },
}))

type MockFn = ReturnType<typeof vi.fn>

type MockGitHelper = {
  isRepository: MockFn
  listWorktrees: MockFn
  hasUncommittedChanges: MockFn
  getBranchRemote: MockFn
  remoteBranchExists: MockFn
  countCommitsBetween: MockFn
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
    mockSimpleGitStatus.mockResolvedValue({ files: {} })

    // Setup mock GitHelper
    mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      getBranchRemote: vi.fn(),
      remoteBranchExists: vi.fn(),
      countCommitsBetween: vi.fn(),
    }

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
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/auth',
        commit: 'abc123',
        isPrunable: false,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(true)
    mockSimpleGitStatus.mockResolvedValue({
      files: {
        'file1.ts': { index: 'M', working_dir: ' ' },
        'file2.ts': { index: ' ', working_dir: 'M' },
      },
    })

    const command = createCommand()

    await command.run()

    expect(mockGitHelper.hasUncommittedChanges).toHaveBeenCalledWith('/worktree1')
    expect(command.log).toHaveBeenCalledWith(expect.stringContaining('2 files modified'))
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
    mockGitHelper.getBranchRemote.mockResolvedValue('origin/feature/fix')
    mockGitHelper.remoteBranchExists.mockResolvedValue(true)
    mockGitHelper.countCommitsBetween.mockResolvedValue(3)

    const command = createCommand()

    await command.run()

    expect(mockGitHelper.getBranchRemote).toHaveBeenCalledWith('feature/fix')
    expect(mockGitHelper.remoteBranchExists).toHaveBeenCalledWith('feature/fix', 'origin')
    expect(mockGitHelper.countCommitsBetween).toHaveBeenCalledWith(
      'origin/feature/fix',
      'feature/fix'
    )
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
    mockGitHelper.getBranchRemote.mockResolvedValue('origin/feature/old')
    mockGitHelper.remoteBranchExists.mockResolvedValue(false)

    const command = createCommand()

    await command.run()

    expect(mockGitHelper.remoteBranchExists).toHaveBeenCalledWith('feature/old', 'origin')
  })

  it('should output JSON format when --json flag is used', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      {
        path: '/worktree1',
        branch: 'feature/auth',
        commit: 'abc123',
        isPrunable: false,
      },
    ])
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)

    const command = createCommand(true)

    await command.run()

    expect(command.log).toHaveBeenCalled()
    const logged = (command.log as any).mock.calls[0][0]
    expect(() => JSON.parse(logged)).not.toThrow()
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
