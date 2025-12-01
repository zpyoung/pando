import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorktreeInfo } from '../../src/utils/git.js'
import RemoveWorktree from '../../src/commands/remove.js'

/**
 * Tests for remove command
 *
 * These tests use mocking to avoid requiring a real git repository
 */

// Mock the git module
vi.mock('../../src/utils/git.js', () => {
  const mockGitHelper = {
    isRepository: vi.fn(),
    getRepositoryRoot: vi.fn(),
    listWorktrees: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    removeWorktree: vi.fn(),
    deleteBranch: vi.fn(),
    deleteRemoteBranch: vi.fn(),
    remoteBranchExists: vi.fn(),
    getBranchRemote: vi.fn(),
    isBranchMerged: vi.fn(),
  }

  return {
    GitHelper: vi.fn(() => mockGitHelper),
    createGitHelper: vi.fn(() => mockGitHelper),
  }
})

// Mock the config loader
vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    rsync: { enabled: true, flags: ['--archive'], exclude: [] },
    symlink: { patterns: [], relative: true, beforeRsync: true },
    worktree: { rebaseOnAdd: true, deleteBranchOnRemove: 'local' },
  }),
}))

// Mock @inquirer/prompts (the actual module used by the command)
vi.mock('@inquirer/prompts', () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
}))

describe('remove', () => {
  let command: RemoveWorktree
  let mockGitHelper: any
  let logSpy: any
  let _errorSpy: any

  beforeEach(async () => {
    // Create mock config
    const mockConfig: any = {
      bin: 'pando',
      runHook: vi.fn().mockResolvedValue({}),
    }

    // Create command instance
    command = new RemoveWorktree([], mockConfig)

    // Get the mocked GitHelper instance
    const { createGitHelper } = await import('../../src/utils/git.js')
    mockGitHelper = createGitHelper()

    // Spy on log and error methods
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    _errorSpy = vi.spyOn(command, 'error').mockImplementation((msg: string) => {
      throw new Error(msg)
    })

    // Reset all mocks
    vi.clearAllMocks()
  })

  it('should successfully remove a worktree', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    command.argv = ['--path', '/path/to/feature']
    await command.run()

    expect(mockGitHelper.isRepository).toHaveBeenCalled()
    expect(mockGitHelper.listWorktrees).toHaveBeenCalled()
    expect(mockGitHelper.hasUncommittedChanges).toHaveBeenCalledWith('/path/to/feature')
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', false)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully removed 1 worktree'))
  })

  it('should handle json output flag', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    command.argv = ['--path', '/path/to/feature', '--json']
    await command.run()

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/"success"\s*:\s*true/))
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/"path"\s*:\s*"\/path\/to\/feature"/))
  })

  it('should error when not in a git repository', async () => {
    mockGitHelper.isRepository.mockResolvedValue(false)

    command.argv = ['--path', '/path/to/feature']

    await expect(command.run()).rejects.toThrow('Not a git repository')
    expect(mockGitHelper.listWorktrees).not.toHaveBeenCalled()
  })

  it('should error when worktree not found', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)

    command.argv = ['--path', '/path/to/nonexistent']

    await expect(command.run()).rejects.toThrow('Worktree not found')
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
  })

  it('should warn about uncommitted changes without force', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(true)

    // Mock the confirm prompt to decline force removal
    const { confirm } = await import('@inquirer/prompts')
    ;(confirm as any).mockResolvedValueOnce(false)

    const exitSpy = vi.spyOn(command, 'exit').mockImplementation(() => {
      throw new Error('exit called')
    })

    command.argv = ['--path', '/path/to/feature']

    await expect(command.run()).rejects.toThrow('exit called')
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to remove 1 worktree'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should force remove worktree with uncommitted changes', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    command.argv = ['--path', '/path/to/feature', '--force']
    await command.run()

    // Should skip uncommitted changes check when using --force
    expect(mockGitHelper.hasUncommittedChanges).not.toHaveBeenCalled()
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', true)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully removed 1 worktree'))
  })

  it('should show warning message when forcing removal', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    command.argv = ['--path', '/path/to/feature', '--force']
    await command.run()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Forced removal'))
  })

  it('should output json error for uncommitted changes', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(true)

    // Mock exit to prevent actual exit
    const exitSpy = vi.spyOn(command, 'exit').mockImplementation(() => {
      throw new Error('exit called')
    })

    command.argv = ['--path', '/path/to/feature', '--json']
    await expect(command.run()).rejects.toThrow('exit called')

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/"success"\s*:\s*false/))
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/"error".*"Has uncommitted changes/))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should handle git errors gracefully', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockRejectedValue(new Error('git operation failed'))

    command.argv = ['--path', '/path/to/feature']

    // The error handling in the command will call this.error() with { exit: false }
    await expect(command.run()).rejects.toThrow()
  })

  it('should output json error format on failure', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockRejectedValue(new Error('git operation failed'))

    command.argv = ['--path', '/path/to/feature', '--json']

    try {
      await command.run()
    } catch {
      // Expected to throw
    }

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/"success"\s*:\s*false/))
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/"error"/))
  })

  it('should match worktree by path', async () => {
    const testPath = '/path/to/feature'
    const mockWorktrees: WorktreeInfo[] = [
      { path: testPath, branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    // Test with the exact path
    command.argv = ['--path', testPath]
    await command.run()

    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith(testPath, false)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully removed 1 worktree'))
  })

  describe('interactive mode', () => {
    let checkboxMock: any
    let confirmMock: any

    beforeEach(async () => {
      const prompts = await import('@inquirer/prompts')
      checkboxMock = prompts.checkbox as any
      confirmMock = prompts.confirm as any
    })

    it('should error when using --json without --path', async () => {
      command.argv = ['--json']

      await expect(command.run()).rejects.toThrow()
      // Verify that an error was thrown (ErrorHelper.validation calls this.error())
    })

    it('should interactively select and remove a single worktree', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      // Mock @inquirer/prompts
      checkboxMock.mockResolvedValueOnce(['/path/to/feature'])
      confirmMock.mockResolvedValueOnce(true)

      command.argv = []
      await command.run()

      expect(checkboxMock).toHaveBeenCalledTimes(1)
      expect(confirmMock).toHaveBeenCalledTimes(1)
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', false)
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully removed 1 worktree')
      )
    })

    it('should exclude main worktree from selection', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      checkboxMock.mockResolvedValueOnce(['/path/to/feature'])
      confirmMock.mockResolvedValueOnce(true)

      command.argv = []
      await command.run()

      // Check that the prompt only included the feature worktree (not main)
      const checkboxCall = checkboxMock.mock.calls[0][0]
      expect(checkboxCall.choices.length).toBe(1)
      expect(checkboxCall.choices[0].value).toBe('/path/to/feature')
    })

    it('should show prunable indicator for prunable worktrees', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/prunable', branch: 'old-feature', commit: 'def456', isPrunable: true },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      checkboxMock.mockResolvedValueOnce(['/path/to/prunable'])
      confirmMock.mockResolvedValueOnce(true)

      command.argv = []
      await command.run()

      // Check that the prunable indicator is shown
      const checkboxCall = checkboxMock.mock.calls[0][0]
      expect(checkboxCall.choices[0].name).toContain('(prunable)')
    })

    it('should handle multiple worktree selection', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature1', branch: 'feature-1', commit: 'def456', isPrunable: false },
        { path: '/path/to/feature2', branch: 'feature-2', commit: 'ghi789', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      checkboxMock.mockResolvedValueOnce(['/path/to/feature1', '/path/to/feature2'])
      confirmMock.mockResolvedValueOnce(true)

      command.argv = []
      await command.run()

      expect(mockGitHelper.removeWorktree).toHaveBeenCalledTimes(2)
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature1', false)
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature2', false)
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully removed 2 worktrees')
      )
    })

    it('should cancel removal when user declines confirmation', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)

      checkboxMock.mockResolvedValueOnce(['/path/to/feature'])
      confirmMock.mockResolvedValueOnce(false) // User declines

      command.argv = []
      await command.run()

      expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Removal cancelled'))
    })

    it('should handle batch removal with mixed success and failure', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature1', branch: 'feature-1', commit: 'def456', isPrunable: false },
        { path: '/path/to/feature2', branch: 'feature-2', commit: 'ghi789', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges
        .mockResolvedValueOnce(false) // feature1 - no uncommitted changes
        .mockResolvedValueOnce(true) // feature2 - has uncommitted changes
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      checkboxMock.mockResolvedValueOnce(['/path/to/feature1', '/path/to/feature2'])
      confirmMock.mockResolvedValueOnce(true)

      const exitSpy = vi.spyOn(command, 'exit').mockImplementation(() => {
        throw new Error('exit called')
      })

      command.argv = []
      await expect(command.run()).rejects.toThrow('exit called')

      // Only feature1 should be removed (feature2 has uncommitted changes)
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledTimes(1)
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature1', false)
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully removed 1 worktree')
      )
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to remove 1 worktree'))
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should handle batch removal with --force flag', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature1', branch: 'feature-1', commit: 'def456', isPrunable: false },
        { path: '/path/to/feature2', branch: 'feature-2', commit: 'ghi789', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      checkboxMock.mockResolvedValueOnce(['/path/to/feature1', '/path/to/feature2'])
      confirmMock.mockResolvedValueOnce(true)

      command.argv = ['--force']
      await command.run()

      // Both should be removed without checking for uncommitted changes
      expect(mockGitHelper.hasUncommittedChanges).not.toHaveBeenCalled()
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledTimes(2)
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature1', true)
      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature2', true)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Forced removal'))
    })

    it('should error when no removable worktrees exist', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)

      command.argv = []

      await expect(command.run()).rejects.toThrow('No worktrees available to remove')
      expect(checkboxMock).not.toHaveBeenCalled()
    })

    it('should display detached HEAD worktrees correctly', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/detached', branch: null, commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)

      checkboxMock.mockResolvedValueOnce(['/path/to/detached'])
      confirmMock.mockResolvedValueOnce(true)

      command.argv = []
      await command.run()

      // Check that detached HEAD is shown
      const checkboxCall = checkboxMock.mock.calls[0][0]
      expect(checkboxCall.choices[0].name).toContain('(detached)')
    })
  })

  describe('branch deletion', () => {
    it('should delete local branch by default (new default behavior)', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      command.argv = ['--path', '/path/to/feature']
      await command.run()

      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', false)
      expect(mockGitHelper.isBranchMerged).toHaveBeenCalledWith('feature-x')
      expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('feature-x', false)
    })

    it('should skip branch deletion with --keep-branch flag', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)

      command.argv = ['--path', '/path/to/feature', '--keep-branch']
      await command.run()

      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', false)
      expect(mockGitHelper.deleteBranch).not.toHaveBeenCalled()
      expect(mockGitHelper.isBranchMerged).not.toHaveBeenCalled()
    })

    it('should respect --delete-branch=none over config default', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/main', branch: 'main', commit: 'abc123', isPrunable: false },
        { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)

      command.argv = ['--path', '/path/to/feature', '--delete-branch', 'none']
      await command.run()

      expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', false)
      expect(mockGitHelper.deleteBranch).not.toHaveBeenCalled()
    })

    it('should show branch deletion info in JSON output', async () => {
      const mockWorktrees: WorktreeInfo[] = [
        { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
      ]

      mockGitHelper.isRepository.mockResolvedValue(true)
      mockGitHelper.getRepositoryRoot.mockResolvedValue('/path/to/repo')
      mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
      mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
      mockGitHelper.removeWorktree.mockResolvedValue(undefined)
      mockGitHelper.isBranchMerged.mockResolvedValue(true)
      mockGitHelper.deleteBranch.mockResolvedValue(undefined)

      command.argv = ['--path', '/path/to/feature', '--json']
      await command.run()

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/"deleteBranchOption"\s*:\s*"local"/)
      )
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/"localDeleted"\s*:\s*true/))
    })
  })
})
