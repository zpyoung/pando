import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GitHelper, WorktreeInfo } from '../../src/utils/git'

// Mock simpleGit for worktree-specific operations
const mockWorktreeGit = {
  raw: vi.fn(),
  status: vi.fn(),
  rebase: vi.fn(),
}

vi.mock('simple-git', async () => {
  const actual = await vi.importActual('simple-git')
  return {
    ...actual,
    simpleGit: vi.fn((path?: string) => {
      // Return worktree mock for non-undefined paths
      if (path) {
        return mockWorktreeGit
      }
      // Return actual for default path (used by constructor)
      return (actual as { simpleGit: (path?: string) => unknown }).simpleGit(path)
    }),
  }
})

/**
 * Tests for GitHelper utility class
 *
 * These tests use mocking to avoid requiring a real git repository
 */

describe('GitHelper', () => {
  let gitHelper: GitHelper
  let mockGit: any

  beforeEach(() => {
    vi.clearAllMocks()
    gitHelper = new GitHelper()
    // Access private git instance through type assertion for testing
    mockGit = (gitHelper as any).git
  })

  describe('repository validation', () => {
    it('should detect valid git repository', async () => {
      mockGit.revparse = vi.fn().mockResolvedValue('/path/to/repo/.git')

      const result = await gitHelper.isRepository()

      expect(result).toBe(true)
      expect(mockGit.revparse).toHaveBeenCalledWith(['--git-dir'])
    })

    it('should return false for non-repository', async () => {
      mockGit.revparse = vi.fn().mockRejectedValue(new Error('not a git repository'))

      const result = await gitHelper.isRepository()

      expect(result).toBe(false)
    })

    it('should get repository root', async () => {
      mockGit.revparse = vi.fn().mockResolvedValue('/path/to/repo\n')

      const result = await gitHelper.getRepositoryRoot()

      expect(result).toBe('/path/to/repo')
      expect(mockGit.revparse).toHaveBeenCalledWith(['--show-toplevel'])
    })

    it('should throw error when not in repository', async () => {
      mockGit.revparse = vi.fn().mockRejectedValue(new Error('not a git repository'))

      await expect(gitHelper.getRepositoryRoot()).rejects.toThrow(
        'Not a git repository or unable to determine root'
      )
    })
  })

  describe('main worktree path', () => {
    it('should get main worktree path', async () => {
      const mockOutput = `worktree /path/to/main
HEAD abc123def456
branch refs/heads/main

worktree /path/to/feature
HEAD def789abc012
branch refs/heads/feature
`
      mockGit.raw = vi.fn().mockResolvedValue(mockOutput)

      const result = await gitHelper.getMainWorktreePath()

      expect(result).toBe('/path/to/main')
      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'list', '--porcelain'])
    })

    it('should throw error if no worktree found', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await expect(gitHelper.getMainWorktreePath()).rejects.toThrow(
        'Unable to determine main worktree path'
      )
    })
  })

  describe('worktree operations', () => {
    it('should add a new worktree with branch', async () => {
      mockGit.raw = vi
        .fn()
        .mockRejectedValueOnce(new Error('not a valid ref')) // branchExists returns false
        .mockResolvedValueOnce('') // worktree add
        .mockResolvedValueOnce('abc123def456\n') // rev-parse HEAD

      const result = await gitHelper.addWorktree('/path/to/new', {
        branch: 'feature-branch',
      })

      expect(result).toEqual({
        path: '/path/to/new',
        branch: 'feature-branch',
        commit: 'abc123def456',
        isPrunable: false,
        isExistingBranch: false,
      })
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'add',
        '-b',
        'feature-branch',
        '/path/to/new',
      ])
    })

    it('should add a worktree with commit reference', async () => {
      mockGit.raw = vi
        .fn()
        .mockRejectedValueOnce(new Error('not a valid ref')) // branchExists returns false
        .mockResolvedValueOnce('') // worktree add
        .mockResolvedValueOnce('abc123def456\n') // rev-parse HEAD

      await gitHelper.addWorktree('/path/to/new', {
        branch: 'feature',
        commit: 'abc123',
      })

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'add',
        '-b',
        'feature',
        '/path/to/new',
        'abc123',
      ])
    })

    it('should checkout existing branch without -b flag', async () => {
      // Mock branchExists to return true
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('abc123def456\n') // branchExists (rev-parse --verify)
        .mockResolvedValueOnce('') // worktree add
        .mockResolvedValueOnce('abc123def456\n') // rev-parse HEAD

      const result = await gitHelper.addWorktree('/path/to/new', {
        branch: 'existing-branch',
      })

      expect(result).toEqual({
        path: '/path/to/new',
        branch: 'existing-branch',
        commit: 'abc123def456',
        isPrunable: false,
        isExistingBranch: true,
      })
      // Should NOT use -b flag for existing branch
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'add',
        '/path/to/new',
        'existing-branch',
      ])
    })

    it('should use -B flag when force is true', async () => {
      // Mock branchExists to return true
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('abc123def456\n') // branchExists (rev-parse --verify)
        .mockResolvedValueOnce('') // worktree add
        .mockResolvedValueOnce('abc123def456\n') // rev-parse HEAD

      await gitHelper.addWorktree('/path/to/new', {
        branch: 'feature',
        force: true,
      })

      // Should use -B flag when force is true
      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'add', '-B', 'feature', '/path/to/new'])
    })

    it('should use -B flag with commit when force is true', async () => {
      // Mock branchExists to return true
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('abc123def456\n') // branchExists (rev-parse --verify)
        .mockResolvedValueOnce('') // worktree add
        .mockResolvedValueOnce('abc123def456\n') // rev-parse HEAD

      await gitHelper.addWorktree('/path/to/new', {
        branch: 'feature',
        commit: 'abc123',
        force: true,
      })

      // Should use -B flag with commit when force is true
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'add',
        '-B',
        'feature',
        '/path/to/new',
        'abc123',
      ])
    })

    it('should list all worktrees', async () => {
      const mockOutput = `worktree /path/to/main
HEAD abc123def456
branch refs/heads/main

worktree /path/to/feature
HEAD def789abc012
branch refs/heads/feature-branch

worktree /path/to/detached
HEAD 111222333444
detached

worktree /path/to/prunable
HEAD 555666777888
branch refs/heads/old-branch
prunable
`
      mockGit.raw = vi.fn().mockResolvedValue(mockOutput)

      const result = await gitHelper.listWorktrees()

      expect(result).toHaveLength(4)
      expect(result[0]).toEqual({
        path: '/path/to/main',
        branch: 'main',
        commit: 'abc123def456',
        isPrunable: false,
      })
      expect(result[1]).toEqual({
        path: '/path/to/feature',
        branch: 'feature-branch',
        commit: 'def789abc012',
        isPrunable: false,
      })
      expect(result[2]).toEqual({
        path: '/path/to/detached',
        branch: null,
        commit: '111222333444',
        isPrunable: false,
      })
      expect(result[3]).toEqual({
        path: '/path/to/prunable',
        branch: 'old-branch',
        commit: '555666777888',
        isPrunable: true,
      })
    })

    it('should remove a worktree', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await gitHelper.removeWorktree('/path/to/worktree')

      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'remove', '/path/to/worktree'])
    })

    it('should force remove a worktree', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await gitHelper.removeWorktree('/path/to/worktree', true)

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'remove',
        '--force',
        '/path/to/worktree',
      ])
    })

    it('should find worktree by exact branch name', async () => {
      const _mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature', branch: 'feature-branch', commit: 'def456', isPrunable: false },
      ]

      // Mock listWorktrees
      mockGit.raw = vi.fn().mockResolvedValue(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature-branch
`)

      const result = await gitHelper.findWorktreeByBranch('feature-branch')

      expect(result).toEqual({
        path: '/path/to/feature',
        branch: 'feature-branch',
        commit: 'def456',
        isPrunable: false,
      })
    })

    it('should find worktree by fuzzy branch name', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature-authentication
`)

      const result = await gitHelper.findWorktreeByBranch('auth')

      expect(result).toEqual({
        path: '/path/to/feature',
        branch: 'feature-authentication',
        commit: 'def456',
        isPrunable: false,
      })
    })

    it('should return null if worktree not found', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`worktree /path/to/main
HEAD abc123
branch refs/heads/main
`)

      const result = await gitHelper.findWorktreeByBranch('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('branch operations', () => {
    it('should create a new branch', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('') // git branch
        .mockResolvedValueOnce('abc123def456\n') // rev-parse

      const result = await gitHelper.createBranch('new-feature')

      expect(result).toEqual({
        name: 'new-feature',
        current: false,
        commit: 'abc123def456',
        label: 'new-feature',
      })
      expect(mockGit.raw).toHaveBeenCalledWith(['branch', 'new-feature'])
      expect(mockGit.raw).toHaveBeenCalledWith(['rev-parse', 'new-feature'])
    })

    it('should create a branch from start point', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('') // git branch
        .mockResolvedValueOnce('abc123def456\n') // rev-parse

      await gitHelper.createBranch('new-feature', 'main')

      expect(mockGit.raw).toHaveBeenCalledWith(['branch', 'new-feature', 'main'])
    })

    it('should delete a branch', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await gitHelper.deleteBranch('old-branch')

      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '-d', 'old-branch'])
    })

    it('should force delete a branch', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await gitHelper.deleteBranch('old-branch', true)

      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '-D', 'old-branch'])
    })

    it('should throw error when deleting unmerged branch without force', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('not fully merged'))

      await expect(gitHelper.deleteBranch('unmerged-branch')).rejects.toThrow(
        "Branch 'unmerged-branch' is not fully merged. Use force=true to delete anyway."
      )
    })

    it('should list all branches', async () => {
      const mockBranchSummary = {
        branches: {
          main: {
            current: true,
            commit: 'abc123',
            label: 'main',
          },
          'feature-1': {
            current: false,
            commit: 'def456',
            label: 'feature-1',
          },
          'feature-2': {
            current: false,
            commit: 'ghi789',
            label: 'feature-2',
          },
        },
      }

      mockGit.branch = vi.fn().mockResolvedValue(mockBranchSummary)

      const result = await gitHelper.listBranches()

      expect(result).toHaveLength(3)
      expect(result).toContainEqual({
        name: 'main',
        current: true,
        commit: 'abc123',
        label: 'main',
      })
      expect(result).toContainEqual({
        name: 'feature-1',
        current: false,
        commit: 'def456',
        label: 'feature-1',
      })
      expect(mockGit.branch).toHaveBeenCalledWith(['-v'])
    })

    it('should check if branch exists', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('abc123def456\n')

      const result = await gitHelper.branchExists('existing-branch')

      expect(result).toBe(true)
      expect(mockGit.raw).toHaveBeenCalledWith([
        'rev-parse',
        '--verify',
        'refs/heads/existing-branch',
      ])
    })

    it('should return false if branch does not exist', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('not a valid ref'))

      const result = await gitHelper.branchExists('nonexistent-branch')

      expect(result).toBe(false)
    })

    it('should check if branch is merged', async () => {
      const mockOutput = `  feature-1
  feature-2
* main
`
      mockGit.raw = vi.fn().mockResolvedValue(mockOutput)

      const result = await gitHelper.isBranchMerged('feature-1')

      expect(result).toBe(true)
      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '--merged', 'HEAD'])
    })

    it('should check if branch is merged into target', async () => {
      const mockOutput = `  feature-1
`
      mockGit.raw = vi.fn().mockResolvedValue(mockOutput)

      const result = await gitHelper.isBranchMerged('feature-1', 'develop')

      expect(result).toBe(true)
      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '--merged', 'develop'])
    })

    it('should return false if branch is not merged', async () => {
      const mockOutput = `  feature-1
  main
`
      mockGit.raw = vi.fn().mockResolvedValue(mockOutput)

      const result = await gitHelper.isBranchMerged('feature-unmerged')

      expect(result).toBe(false)
    })

    it('should get current branch', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('main\n')

      const result = await gitHelper.getCurrentBranch()

      expect(result).toBe('main')
      expect(mockGit.raw).toHaveBeenCalledWith(['rev-parse', '--abbrev-ref', 'HEAD'])
    })

    it('should throw error when HEAD is detached', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('HEAD\n')

      await expect(gitHelper.getCurrentBranch()).rejects.toThrow(
        'HEAD is detached (not on any branch)'
      )
    })

    it('should handle errors when getting current branch', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('fatal: not a git repository'))

      await expect(gitHelper.getCurrentBranch()).rejects.toThrow(
        'Unable to determine current branch: fatal: not a git repository'
      )
    })
  })

  describe('setSkipWorktree', () => {
    it('should mark files as skip-worktree', async () => {
      mockWorktreeGit.raw.mockResolvedValue('')

      const result = await gitHelper.setSkipWorktree('/path/to/worktree', [
        'package.json',
        'pnpm-lock.yaml',
      ])

      expect(result.success).toBe(true)
      expect(result.filesMarked).toBe(2)
      expect(result.error).toBeUndefined()
      expect(mockWorktreeGit.raw).toHaveBeenCalledWith([
        'update-index',
        '--skip-worktree',
        'package.json',
        'pnpm-lock.yaml',
      ])
    })

    it('should return success with 0 files when array is empty', async () => {
      const result = await gitHelper.setSkipWorktree('/path/to/worktree', [])

      expect(result.success).toBe(true)
      expect(result.filesMarked).toBe(0)
      // No git calls should be made for empty array
      expect(mockWorktreeGit.raw).not.toHaveBeenCalled()
    })

    it('should handle errors gracefully', async () => {
      mockWorktreeGit.raw.mockRejectedValue(new Error('fatal: Unable to mark file'))

      const result = await gitHelper.setSkipWorktree('/path/to/worktree', ['invalid-file'])

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unable to mark file')
      expect(result.filesMarked).toBe(0)
    })

    it('should handle single file', async () => {
      mockWorktreeGit.raw.mockResolvedValue('')

      const result = await gitHelper.setSkipWorktree('/path/to/worktree', ['node_modules'])

      expect(result.success).toBe(true)
      expect(result.filesMarked).toBe(1)
      expect(mockWorktreeGit.raw).toHaveBeenCalledWith([
        'update-index',
        '--skip-worktree',
        'node_modules',
      ])
    })
  })
})
