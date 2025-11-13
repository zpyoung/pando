import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GitHelper, WorktreeInfo } from '../../../src/utils/git.js'
import RemoveWorktree from '../../../src/commands/worktree/remove.js'

/**
 * Tests for worktree remove command
 *
 * These tests use mocking to avoid requiring a real git repository
 */

// Mock the git module
vi.mock('../../../src/utils/git.js', () => {
  const mockGitHelper = {
    isRepository: vi.fn(),
    listWorktrees: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    removeWorktree: vi.fn(),
  }

  return {
    GitHelper: vi.fn(() => mockGitHelper),
    createGitHelper: vi.fn(() => mockGitHelper),
  }
})

describe('worktree remove', () => {
  let command: RemoveWorktree
  let mockGitHelper: any
  let logSpy: any
  let errorSpy: any

  beforeEach(async () => {
    // Create mock config
    const mockConfig: any = {
      bin: 'pando',
      runHook: vi.fn().mockResolvedValue({}),
    }

    // Create command instance
    command = new RemoveWorktree([], mockConfig)

    // Get the mocked GitHelper instance
    const { createGitHelper } = await import('../../../src/utils/git.js')
    mockGitHelper = createGitHelper()

    // Spy on log and error methods
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(command, 'error').mockImplementation((msg: string) => {
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
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    command.argv = ['--path', '/path/to/feature']
    await command.run()

    expect(mockGitHelper.isRepository).toHaveBeenCalled()
    expect(mockGitHelper.listWorktrees).toHaveBeenCalled()
    expect(mockGitHelper.hasUncommittedChanges).toHaveBeenCalledWith('/path/to/feature')
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', false)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree removed successfully'))
  })

  it('should handle json output flag', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    command.argv = ['--path', '/path/to/feature', '--json']
    await command.run()

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"success"\s*:\s*true/)
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"path"\s*:\s*"\/path\/to\/feature"/)
    )
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
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(true)

    command.argv = ['--path', '/path/to/feature']

    await expect(command.run()).rejects.toThrow('uncommitted changes')
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
  })

  it('should force remove worktree with uncommitted changes', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    command.argv = ['--path', '/path/to/feature', '--force']
    await command.run()

    // Should skip uncommitted changes check when using --force
    expect(mockGitHelper.hasUncommittedChanges).not.toHaveBeenCalled()
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/path/to/feature', true)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree removed successfully'))
  })

  it('should show warning message when forcing removal', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
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
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(true)

    command.argv = ['--path', '/path/to/feature', '--json']
    await command.run()

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"success"\s*:\s*false/)
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"hasUncommittedChanges"\s*:\s*true/)
    )
  })

  it('should handle git errors gracefully', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockRejectedValue(new Error('git operation failed'))

    command.argv = ['--path', '/path/to/feature']

    await expect(command.run()).rejects.toThrow('Failed to remove worktree')
  })

  it('should output json error format on failure', async () => {
    const mockWorktrees: WorktreeInfo[] = [
      { path: '/path/to/feature', branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockRejectedValue(new Error('git operation failed'))

    command.argv = ['--path', '/path/to/feature', '--json']

    try {
      await command.run()
    } catch {
      // Expected to throw
    }

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"success"\s*:\s*false/)
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"error"/)
    )
  })

  it('should match worktree by path', async () => {
    const testPath = '/path/to/feature'
    const mockWorktrees: WorktreeInfo[] = [
      { path: testPath, branch: 'feature-x', commit: 'def456', isPrunable: false },
    ]

    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.listWorktrees.mockResolvedValue(mockWorktrees)
    mockGitHelper.hasUncommittedChanges.mockResolvedValue(false)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)

    // Test with the exact path
    command.argv = ['--path', testPath]
    await command.run()

    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith(testPath, false)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree removed successfully'))
  })
})
