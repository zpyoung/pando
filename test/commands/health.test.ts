import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Health } from '../src/commands/health.js'
import { createGitHelper } from '../src/utils/git.js'
import { ErrorHelper } from '../src/utils/errors.js'

// Mock the dependencies
vi.mock('../src/utils/git.js')
vi.mock('../src/utils/errors.js')
vi.mock('chalk', () => ({
  default: {
    bold: (str: string) => `**${str}**`,
    red: (str: string) => `<red>${str}</red>`,
    yellow: (str: string) => `<yellow>${str}</yellow>`,
    green: (str: string) => `<green>${str}</green>`,
    cyan: (str: string) => `<cyan>${str}</cyan>`,
    gray: (str: string) => `<gray>${str}</gray>`,
    magenta: (str: string) => `<magenta>${str}</m>`,
    redBright: (str: string) => `<redBright>${str}</redBright>`,
  },
}))

describe('Health Command', () => {
  let mockGitHelper: any
  let mockErrorHelper: any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Setup mock GitHelper
    mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      getBranchRemote: vi.fn(),
      remoteBranchExists: vi.fn(),
      countCommitsBetween: vi.fn(),
      getMainBranch: vi.fn().mockResolvedValue('main'),
    }

    mockErrorHelper = {
      validation: vi.fn(),
      operation: vi.fn(),
    }

    vi.mocked(createGitHelper).mockReturnValue(mockGitHelper)
    vi.mocked(ErrorHelper.validation).mockImplementation((...args: any[]) => mockErrorHelper.validation(...args))
    vi.mocked(ErrorHelper.operation).mockImplementation((...args: any[]) => mockErrorHelper.operation(...args))
  })

  it('should validate that current directory is a git repository', async () => {
    mockGitHelper.isRepository.mockResolvedValue(false)

    const command = new Health([], {} as any)
    command.log = vi.fn()

    await command.run()

    expect(mockErrorHelper.validation).toHaveBeenCalled()
    expect(mockErrorHelper.validation).toHaveBeenCalledWith(
      expect.anything(),
      'Not a git repository. Run this command from within a git repository.',
      undefined
    )
  })

  it('should show empty state when no worktrees exist', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([])

    const command = new Health([], {} as any)
    command.log = vi.fn()

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

    // Mock simple-git status call
    const mockSimpleGit = {
      status: vi.fn().mockResolvedValue({
        files: {
          'file1.ts': { index: 'M', working_dir: ' ' },
          'file2.ts': { index: ' ', working_dir: 'M' },
        },
      }),
    }
    vi.doMock('simple-git', () => ({
      simpleGit: vi.fn(() => mockSimpleGit),
    }))

    const command = new Health([], {} as any)
    command.log = vi.fn()

    await command.run()

    expect(mockGitHelper.hasUncommittedChanges).toHaveBeenCalledWith('/worktree1')
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

    const command = new Health([], {} as any)
    command.log = vi.fn()

    await command.run()

    expect(mockGitHelper.getBranchRemote).toHaveBeenCalledWith('feature/fix')
    expect(mockGitHelper.countCommitsBetween).toHaveBeenCalledWith('origin/feature/fix', 'feature/fix')
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

    const command = new Health([], {} as any)
    command.log = vi.fn()

    await command.run()

    expect(mockGitHelper.remoteBranchExists).toHaveBeenCalledWith('old', 'origin')
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

    const command = new Health(['--json'], {} as any)
    command.log = vi.fn()

    await command.run()

    expect(command.log).toHaveBeenCalled()
    const logged = (command.log as any).mock.calls[0][0]
    expect(() => JSON.parse(logged)).not.toThrow()
  })

  it('should handle errors gracefully', async () => {
    mockGitHelper.listWorktrees.mockRejectedValue(new Error('Git error'))

    const command = new Health([], {} as any)
    command.log = vi.fn()

    await command.run()

    expect(mockErrorHelper.operation).toHaveBeenCalled()
    expect(mockErrorHelper.operation).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Error),
      'Failed to check worktree health',
      undefined
    )
  })
})
