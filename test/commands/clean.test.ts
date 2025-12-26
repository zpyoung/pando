import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StaleWorktreeInfo } from '../../src/utils/git.js'
import CleanWorktree from '../../src/commands/clean.js'

/**
 * Tests for clean command
 *
 * These tests use mocking to avoid requiring a real git repository
 */

// Mock the git module
vi.mock('../../src/utils/git.js', () => {
  const mockGitHelper = {
    isRepository: vi.fn(),
    getRepositoryRoot: vi.fn(),
    getStaleWorktrees: vi.fn(),
    fetchWithPrune: vi.fn(),
    removeWorktree: vi.fn(),
    deleteBranch: vi.fn(),
  }

  return {
    GitHelper: vi.fn(() => mockGitHelper),
    createGitHelper: vi.fn(() => mockGitHelper),
  }
})

// Mock the config loader
vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    rsync: { enabled: true, flags: [], exclude: [] },
    symlink: { patterns: [], relative: true, beforeRsync: true },
    worktree: {
      rebaseOnAdd: true,
      deleteBranchOnRemove: 'local',
      useProjectSubfolder: false,
      targetBranch: 'main',
    },
    clean: { fetch: false },
  }),
}))

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
}))

describe('clean', () => {
  let command: CleanWorktree
  let mockGitHelper: ReturnType<typeof _getMockGitHelper>
  let logSpy: ReturnType<typeof vi.spyOn>

  function _getMockGitHelper() {
    return {
      isRepository: vi.fn(),
      getRepositoryRoot: vi.fn(),
      getStaleWorktrees: vi.fn(),
      fetchWithPrune: vi.fn(),
      removeWorktree: vi.fn(),
      deleteBranch: vi.fn(),
    }
  }

  beforeEach(async () => {
    // Create mock config
    const mockConfig: { bin: string; runHook: ReturnType<typeof vi.fn> } = {
      bin: 'pando',
      runHook: vi.fn().mockResolvedValue({}),
    }

    // Create command instance
    command = new CleanWorktree([], mockConfig)

    // Get the mocked GitHelper instance
    const { createGitHelper } = await import('../../src/utils/git.js')
    mockGitHelper = createGitHelper() as unknown as ReturnType<typeof getMockGitHelper>

    // Spy on log method
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    vi.spyOn(command, 'error').mockImplementation((msg: string | Error) => {
      throw new Error(typeof msg === 'string' ? msg : msg.message)
    })

    // Reset all mocks
    vi.clearAllMocks()
  })

  describe('nothing to clean', () => {
    it('should output nothing_to_clean when no stale worktrees', async () => {
      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue([])

      command.argv = ['--json']
      await command.run()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"status": "nothing_to_clean"'))
    })

    it('should show friendly message in non-json mode', async () => {
      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue([])

      command.argv = []
      await command.run()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No stale worktrees found'))
    })
  })

  describe('dry-run mode', () => {
    it('should show what would be removed without acting', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/merged',
          branch: 'merged-branch',
          commit: 'abc123',
          isPrunable: false,
          staleReason: 'merged',
          hasUncommittedChanges: false,
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)

      command.argv = ['--dry-run', '--json']
      await command.run()

      // Should NOT have called removeWorktree
      expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()

      // Should output the stale worktrees
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"staleWorktrees"'))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"skipped"'))
    })
  })

  describe('force mode', () => {
    it('should clean all stale worktrees without prompts', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/merged',
          branch: 'merged-branch',
          commit: 'abc123',
          isPrunable: false,
          staleReason: 'merged',
          hasUncommittedChanges: false,
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      command.argv = ['--force']
      await command.run()

      // When --force is set, removeWorktree is called with force=true
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/merged', true)
      expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('merged-branch', true)
    })

    it('should force delete branches when --force flag is set', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/gone',
          branch: 'gone-branch',
          commit: 'abc123',
          isPrunable: false,
          staleReason: 'gone',
          hasUncommittedChanges: false,
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      command.argv = ['--force']
      await command.run()

      // Should use force=true for deleteBranch when --force is set
      expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('gone-branch', true)
    })
  })

  describe('keep-branch flag', () => {
    it('should preserve branch with --keep-branch', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/merged',
          branch: 'merged-branch',
          commit: 'abc123',
          isPrunable: false,
          staleReason: 'merged',
          hasUncommittedChanges: false,
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)

      command.argv = ['--force', '--keep-branch']
      await command.run()

      expect(mockGitHelper.removeWorktree).toHaveBeenCalled()
      expect(mockGitHelper.deleteBranch).not.toHaveBeenCalled()
    })
  })

  describe('json output', () => {
    it('should output valid CleanResult schema', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/merged',
          branch: 'merged-branch',
          commit: 'abc123',
          isPrunable: false,
          staleReason: 'merged',
          hasUncommittedChanges: false,
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      command.argv = ['--json']
      await command.run()

      // Verify JSON was logged
      expect(logSpy).toHaveBeenCalled()
      const loggedJson = logSpy.mock.calls[0]?.[0]
      expect(loggedJson).toBeDefined()

      const result = JSON.parse(loggedJson)
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('staleWorktrees')
      expect(result).toHaveProperty('removed')
      expect(result).toHaveProperty('skipped')
      expect(result).toHaveProperty('errors')
    })

    it('should include errors in json output', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/merged',
          branch: 'merged-branch',
          commit: 'abc123',
          isPrunable: false,
          staleReason: 'merged',
          hasUncommittedChanges: false,
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)
      mockGitHelper.removeWorktree.mockRejectedValue(new Error('Cannot remove worktree'))

      command.argv = ['--json']

      // Command should not throw in json mode, just include errors in output
      await expect(command.run()).rejects.toThrow()
    })
  })

  describe('fetch flag', () => {
    it('should run git fetch --prune with --fetch', async () => {
      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.fetchWithPrune.mockResolvedValue(undefined)
      mockGitHelper.getStaleWorktrees.mockResolvedValue([])

      command.argv = ['--fetch', '--json']
      await command.run()

      expect(mockGitHelper.fetchWithPrune).toHaveBeenCalled()
    })

    it('should continue on fetch failure', async () => {
      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.fetchWithPrune.mockRejectedValue(new Error('Network error'))
      mockGitHelper.getStaleWorktrees.mockResolvedValue([])

      command.argv = ['--fetch', '--json']
      await command.run()

      // Should still proceed to getStaleWorktrees even if fetch fails
      expect(mockGitHelper.getStaleWorktrees).toHaveBeenCalled()
    })
  })

  describe('target-branch flag', () => {
    it('should pass target branch to getStaleWorktrees', async () => {
      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue([])

      command.argv = ['--target-branch', 'develop', '--json']
      await command.run()

      expect(mockGitHelper.getStaleWorktrees).toHaveBeenCalledWith('develop')
    })
  })

  describe('error handling', () => {
    it('should error when not in git repository', async () => {
      mockGitHelper.isRepository.mockResolvedValue(false)

      command.argv = []

      await expect(command.run()).rejects.toThrow()
    })

    it('should output error in json format when --json flag is set', async () => {
      mockGitHelper.isRepository.mockResolvedValue(false)

      command.argv = ['--json']

      // The validation should throw via ErrorHelper
      await expect(command.run()).rejects.toThrow()
    })
  })

  describe('stale reason detection', () => {
    it('should handle prunable worktrees', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/prunable',
          branch: 'prunable-branch',
          commit: 'abc123',
          isPrunable: true,
          staleReason: 'prunable',
          hasUncommittedChanges: false,
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      command.argv = ['--force', '--json']
      await command.run()

      // When --force is set, removeWorktree is called with force=true
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/prunable', true)
    })

    it('should handle gone worktrees', async () => {
      const staleWorktrees: StaleWorktreeInfo[] = [
        {
          path: '/path/to/gone',
          branch: 'gone-branch',
          commit: 'abc123',
          isPrunable: false,
          staleReason: 'gone',
          hasUncommittedChanges: false,
          trackingBranch: 'refs/heads/gone-branch',
        },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/test/repo')
      mockGitHelper.getStaleWorktrees.mockResolvedValue(staleWorktrees)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      command.argv = ['--force', '--json']
      await command.run()

      expect(mockGitHelper.removeWorktree).toHaveBeenCalled()

      const loggedJson = logSpy.mock.calls[0]?.[0]
      const result = JSON.parse(loggedJson)
      expect(result.removed[0]?.staleReason).toBe('gone')
    })
  })
})
