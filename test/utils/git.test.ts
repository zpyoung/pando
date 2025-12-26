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

  describe('getCommitHash', () => {
    it('should return commit hash for a valid ref', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('abc123def456789\n')

      const result = await gitHelper.getCommitHash('main')

      expect(result).toBe('abc123def456789')
      expect(mockGit.raw).toHaveBeenCalledWith(['rev-parse', 'main'])
    })

    it('should throw error for invalid ref', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('unknown revision'))

      await expect(gitHelper.getCommitHash('nonexistent')).rejects.toThrow(
        "Unable to resolve ref 'nonexistent'"
      )
    })
  })

  describe('forceUpdateBranch', () => {
    it('should force update branch to commit', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await gitHelper.forceUpdateBranch('feature', 'abc123')

      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '-f', 'feature', 'abc123'])
    })

    it('should throw error on failure', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('cannot update'))

      await expect(gitHelper.forceUpdateBranch('feature', 'abc123')).rejects.toThrow(
        "Failed to update branch 'feature'"
      )
    })
  })

  describe('resetHard', () => {
    it('should reset to specified commit', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await gitHelper.resetHard('abc123')

      expect(mockGit.raw).toHaveBeenCalledWith(['reset', '--hard', 'abc123'])
    })

    it('should throw error on failure', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('bad revision'))

      await expect(gitHelper.resetHard('invalid')).rejects.toThrow("Failed to reset to 'invalid'")
    })
  })

  describe('setBranchDescription', () => {
    it('should set branch description', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      await gitHelper.setBranchDescription('feature', 'My description')

      expect(mockGit.raw).toHaveBeenCalledWith([
        'config',
        'branch.feature.description',
        'My description',
      ])
    })

    it('should throw error on failure', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('config error'))

      await expect(gitHelper.setBranchDescription('feature', 'desc')).rejects.toThrow(
        "Failed to set description for branch 'feature'"
      )
    })
  })

  describe('getBranchDescription', () => {
    it('should get branch description', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('My backup description\n')

      const result = await gitHelper.getBranchDescription('backup/feature/20250117-120000')

      expect(result).toBe('My backup description')
      expect(mockGit.raw).toHaveBeenCalledWith([
        'config',
        '--get',
        'branch.backup/feature/20250117-120000.description',
      ])
    })

    it('should return null if description not set', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('key not found'))

      const result = await gitHelper.getBranchDescription('feature')

      expect(result).toBeNull()
    })

    it('should return null for empty description', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('   \n')

      const result = await gitHelper.getBranchDescription('feature')

      expect(result).toBeNull()
    })
  })

  describe('listBackupBranches', () => {
    it('should list backup branches for a source branch', async () => {
      const mockOutput =
        'backup/feature/20250117-120000\x00abc123\n' + 'backup/feature/20250116-100000\x00def456\n'
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(mockOutput) // for-each-ref
        .mockRejectedValueOnce(new Error('no description')) // getBranchDescription first
        .mockResolvedValueOnce('Before rebase\n') // getBranchDescription second

      const result = await gitHelper.listBackupBranches('feature')

      expect(result).toHaveLength(2)
      // Should be sorted newest first
      expect(result[0]).toEqual({
        name: 'backup/feature/20250117-120000',
        sourceBranch: 'feature',
        commit: 'abc123',
        timestamp: '2025-01-17T12:00:00Z',
        message: undefined,
      })
      expect(result[1]).toEqual({
        name: 'backup/feature/20250116-100000',
        sourceBranch: 'feature',
        commit: 'def456',
        timestamp: '2025-01-16T10:00:00Z',
        message: 'Before rebase',
      })
    })

    it('should return empty array if no backups found', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('')

      const result = await gitHelper.listBackupBranches('feature')

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('git error'))

      const result = await gitHelper.listBackupBranches('feature')

      expect(result).toEqual([])
    })

    it('should skip branches with invalid timestamp format', async () => {
      const mockOutput =
        'backup/feature/invalid-timestamp\x00abc123\n' +
        'backup/feature/20250117-120000\x00def456\n'
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(mockOutput)
        .mockRejectedValueOnce(new Error('no description'))

      const result = await gitHelper.listBackupBranches('feature')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('backup/feature/20250117-120000')
    })

    it('should handle nested source branches', async () => {
      const mockOutput = 'backup/feature/auth/20250117-120000\x00abc123\n'
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(mockOutput)
        .mockRejectedValueOnce(new Error('no description'))

      const result = await gitHelper.listBackupBranches('feature/auth')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: 'backup/feature/auth/20250117-120000',
        sourceBranch: 'feature/auth',
        commit: 'abc123',
        timestamp: '2025-01-17T12:00:00Z',
        message: undefined,
      })
    })
  })

  describe('fetchWithPrune', () => {
    it('should fetch with prune from default remote', async () => {
      mockGit.fetch = vi.fn().mockResolvedValue({})

      await gitHelper.fetchWithPrune()

      expect(mockGit.fetch).toHaveBeenCalledWith(['origin', '--prune'])
    })

    it('should fetch with prune from specified remote', async () => {
      mockGit.fetch = vi.fn().mockResolvedValue({})

      await gitHelper.fetchWithPrune('upstream')

      expect(mockGit.fetch).toHaveBeenCalledWith(['upstream', '--prune'])
    })
  })

  describe('getMainBranch', () => {
    it('should return main if main branch exists', async () => {
      mockGit.raw = vi.fn().mockResolvedValue('abc123\n')

      const result = await gitHelper.getMainBranch()

      expect(result).toBe('main')
      expect(mockGit.raw).toHaveBeenCalledWith(['rev-parse', '--verify', 'refs/heads/main'])
    })

    it('should return master if main does not exist but master does', async () => {
      mockGit.raw = vi
        .fn()
        .mockRejectedValueOnce(new Error('not a valid ref')) // main check
        .mockResolvedValueOnce('abc123\n') // master check

      const result = await gitHelper.getMainBranch()

      expect(result).toBe('master')
    })

    it('should default to main if neither exists', async () => {
      mockGit.raw = vi
        .fn()
        .mockRejectedValueOnce(new Error('not a valid ref')) // main check
        .mockRejectedValueOnce(new Error('not a valid ref')) // master check

      const result = await gitHelper.getMainBranch()

      expect(result).toBe('main')
    })
  })

  describe('getMergedBranches', () => {
    it('should return list of merged branches', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`  feature-1
  feature-2
* main
`)

      const result = await gitHelper.getMergedBranches('main')

      expect(result).toEqual(['feature-1', 'feature-2'])
      expect(mockGit.raw).toHaveBeenCalledWith(['branch', '--merged', 'main'])
    })

    it('should exclude target branch from results', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`  develop
* main
`)

      const result = await gitHelper.getMergedBranches('main')

      expect(result).toEqual(['develop'])
      expect(result).not.toContain('main')
    })

    it('should fallback to master if main does not exist', async () => {
      mockGit.raw = vi.fn().mockRejectedValueOnce(new Error('not a valid ref')) // main
        .mockResolvedValueOnce(`  feature-1
`)

      const result = await gitHelper.getMergedBranches('main')

      expect(result).toEqual(['feature-1'])
    })

    it('should return empty array on error', async () => {
      mockGit.raw = vi
        .fn()
        .mockRejectedValueOnce(new Error('not a valid ref')) // main
        .mockRejectedValueOnce(new Error('not a valid ref')) // master fallback

      const result = await gitHelper.getMergedBranches('main')

      expect(result).toEqual([])
    })
  })

  describe('getGoneBranches', () => {
    it('should detect branches with gone upstream', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(
          `feature-1 [gone]
feature-2 [ahead 1]
feature-3
`
        ) // for-each-ref
        .mockResolvedValueOnce('refs/heads/feature-1') // branch config

      const result = await gitHelper.getGoneBranches()

      expect(result.size).toBe(1)
      expect(result.has('feature-1')).toBe(true)
    })

    it('should return empty map if no gone branches', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`feature-1 [ahead 1]
feature-2
main
`)

      const result = await gitHelper.getGoneBranches()

      expect(result.size).toBe(0)
    })

    it('should handle errors gracefully', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('git error'))

      const result = await gitHelper.getGoneBranches()

      expect(result.size).toBe(0)
    })
  })

  describe('findWorktreeByBranchExact', () => {
    it('should find worktree by exact branch name', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature-auth
`)

      const result = await gitHelper.findWorktreeByBranchExact('feature-auth')

      expect(result).toEqual({
        path: '/path/to/feature',
        branch: 'feature-auth',
        commit: 'def456',
        isPrunable: false,
      })
    })

    it('should return null for partial match (unlike fuzzy method)', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`worktree /path/to/feature
HEAD def456
branch refs/heads/feature-authentication
`)

      // findWorktreeByBranch would find this with "auth"
      // findWorktreeByBranchExact should NOT
      const result = await gitHelper.findWorktreeByBranchExact('auth')

      expect(result).toBeNull()
    })

    it('should return null if branch not found', async () => {
      mockGit.raw = vi.fn().mockResolvedValue(`worktree /path/to/main
HEAD abc123
branch refs/heads/main
`)

      const result = await gitHelper.findWorktreeByBranchExact('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getCommitLogBetween', () => {
    it('should return commits between two refs', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('3\n') // rev-list --count
        .mockResolvedValueOnce(
          'abc1234 First commit\ndef5678 Second commit\nghi9012 Third commit\n'
        )

      const result = await gitHelper.getCommitLogBetween('main', 'feature')

      expect(result).toEqual({
        commits: [
          { hash: 'abc1234', message: 'First commit' },
          { hash: 'def5678', message: 'Second commit' },
          { hash: 'ghi9012', message: 'Third commit' },
        ],
        totalCount: 3,
      })
      expect(mockGit.raw).toHaveBeenCalledWith(['rev-list', '--count', 'main..feature', '--'])
      expect(mockGit.raw).toHaveBeenCalledWith([
        'log',
        'main..feature',
        '--format=%h %s',
        '-n',
        '10',
        '--',
      ])
    })

    it('should return empty array when no commits between refs', async () => {
      mockGit.raw = vi.fn().mockResolvedValueOnce('0\n')

      const result = await gitHelper.getCommitLogBetween('main', 'main')

      expect(result).toEqual({ commits: [], totalCount: 0 })
    })

    it('should respect limit parameter', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('5\n')
        .mockResolvedValueOnce('abc1234 Commit 1\ndef5678 Commit 2\n')

      const result = await gitHelper.getCommitLogBetween('main', 'feature', 2)

      expect(result).toEqual({
        commits: [
          { hash: 'abc1234', message: 'Commit 1' },
          { hash: 'def5678', message: 'Commit 2' },
        ],
        totalCount: 5,
      })
      expect(mockGit.raw).toHaveBeenCalledWith([
        'log',
        'main..feature',
        '--format=%h %s',
        '-n',
        '2',
        '--',
      ])
    })

    it('should handle commits with no message', async () => {
      mockGit.raw = vi.fn().mockResolvedValueOnce('1\n').mockResolvedValueOnce('abc1234\n')

      const result = await gitHelper.getCommitLogBetween('main', 'feature')

      expect(result?.commits[0]).toEqual({ hash: 'abc1234', message: '' })
    })

    it('should handle commit messages with spaces', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce('1\n')
        .mockResolvedValueOnce('abc1234 Fix bug in user authentication module\n')

      const result = await gitHelper.getCommitLogBetween('main', 'feature')

      expect(result?.commits[0]).toEqual({
        hash: 'abc1234',
        message: 'Fix bug in user authentication module',
      })
    })

    it('should return null on git error', async () => {
      mockGit.raw = vi.fn().mockRejectedValue(new Error('git error'))

      const result = await gitHelper.getCommitLogBetween('invalid', 'refs')

      expect(result).toBeNull()
    })

    it('should handle empty log output after count', async () => {
      mockGit.raw = vi.fn().mockResolvedValueOnce('2\n').mockResolvedValueOnce('')

      const result = await gitHelper.getCommitLogBetween('main', 'feature')

      expect(result).toEqual({ commits: [], totalCount: 2 })
    })
  })

  describe('getStaleWorktrees', () => {
    it('should detect merged worktrees', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(
          `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature-merged
`
        ) // listWorktrees
        .mockResolvedValueOnce('abc123\n') // getMainBranch (main exists)
        .mockResolvedValueOnce(`  feature-merged
* main
`) // getMergedBranches
        .mockResolvedValueOnce(`main
feature-merged
`) // getGoneBranches (for-each-ref)
        .mockResolvedValueOnce(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature-merged
`) // getMainWorktreePath

      mockWorktreeGit.status.mockResolvedValue({ isClean: () => true })

      const result = await gitHelper.getStaleWorktrees()

      expect(result).toHaveLength(1)
      expect(result[0]?.staleReason).toBe('merged')
      expect(result[0]?.branch).toBe('feature-merged')
    })

    it('should detect prunable worktrees', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(
          `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/deleted
HEAD def456
branch refs/heads/deleted-branch
prunable
`
        ) // listWorktrees
        .mockResolvedValueOnce('abc123\n') // getMainBranch
        .mockResolvedValueOnce('* main\n') // getMergedBranches
        .mockResolvedValueOnce('main \n') // getGoneBranches
        .mockResolvedValueOnce(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/deleted
HEAD def456
branch refs/heads/deleted-branch
prunable
`) // getMainWorktreePath

      const result = await gitHelper.getStaleWorktrees()

      expect(result).toHaveLength(1)
      expect(result[0]?.staleReason).toBe('prunable')
      expect(result[0]?.hasUncommittedChanges).toBe(false) // Prunable skips this check
    })

    it('should detect gone worktrees', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(
          `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/gone
HEAD def456
branch refs/heads/gone-branch
`
        ) // listWorktrees
        .mockResolvedValueOnce('abc123\n') // getMainBranch
        .mockResolvedValueOnce('* main\n') // getMergedBranches
        .mockResolvedValueOnce(
          `main
gone-branch [gone]
`
        ) // getGoneBranches
        .mockResolvedValueOnce('refs/heads/gone-branch') // branch config
        .mockResolvedValueOnce(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/gone
HEAD def456
branch refs/heads/gone-branch
`) // getMainWorktreePath

      mockWorktreeGit.status.mockResolvedValue({ isClean: () => true })

      const result = await gitHelper.getStaleWorktrees()

      expect(result).toHaveLength(1)
      expect(result[0]?.staleReason).toBe('gone')
    })

    it('should exclude main worktree from results', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(
          `worktree /path/to/main
HEAD abc123
branch refs/heads/main
`
        ) // listWorktrees
        .mockResolvedValueOnce('abc123\n') // getMainBranch
        .mockResolvedValueOnce('* main\n') // getMergedBranches
        .mockResolvedValueOnce('main \n') // getGoneBranches
        .mockResolvedValueOnce(`worktree /path/to/main
HEAD abc123
branch refs/heads/main
`) // getMainWorktreePath

      const result = await gitHelper.getStaleWorktrees()

      expect(result).toHaveLength(0)
    })

    it('should prioritize prunable over other reasons', async () => {
      // A branch that is both merged AND prunable should be marked as prunable
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(
          `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/merged-and-prunable
prunable
`
        ) // listWorktrees
        .mockResolvedValueOnce('abc123\n') // getMainBranch
        .mockResolvedValueOnce(
          `  merged-and-prunable
* main
`
        ) // getMergedBranches
        .mockResolvedValueOnce('main \n') // getGoneBranches
        .mockResolvedValueOnce(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/merged-and-prunable
prunable
`) // getMainWorktreePath

      const result = await gitHelper.getStaleWorktrees()

      expect(result).toHaveLength(1)
      expect(result[0]?.staleReason).toBe('prunable')
    })

    it('should return empty array if no stale worktrees', async () => {
      mockGit.raw = vi
        .fn()
        .mockResolvedValueOnce(
          `worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/active-feature
`
        ) // listWorktrees
        .mockResolvedValueOnce('abc123\n') // getMainBranch
        .mockResolvedValueOnce('* main\n') // getMergedBranches (no merged branches except main)
        .mockResolvedValueOnce('main \nactive-feature \n') // getGoneBranches (no gone)
        .mockResolvedValueOnce(`worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/active-feature
`) // getMainWorktreePath

      const result = await gitHelper.getStaleWorktrees()

      expect(result).toHaveLength(0)
    })
  })
})
