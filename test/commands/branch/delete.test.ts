import { describe, it, expect, vi, beforeEach } from 'vitest'
import DeleteBranch from '../../../src/commands/branch/delete.js'
import * as gitUtils from '../../../src/utils/git.js'

/**
 * Tests for branch delete command
 *
 * Tests cover all core functionality including:
 * - Deleting branches
 * - Validating required flags
 * - Safety checks for unmerged branches
 * - Force deletion
 * - Worktree removal
 * - JSON output format
 * - Error handling
 */

describe('branch delete', () => {
  let command: DeleteBranch
  let logSpy: any
  let errorSpy: any

  beforeEach(() => {
    // Reset all mocks before each test
    vi.restoreAllMocks()

    // Create command instance
    command = new DeleteBranch([], {} as any)

    // Spy on log and error methods
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(command, 'error').mockImplementation(() => {
      throw new Error('Command error')
    })
  })

  it('should verify command exists and is properly configured', () => {
    expect(DeleteBranch.description).toBe('Delete a git branch')
    expect(DeleteBranch.flags).toHaveProperty('name')
    expect(DeleteBranch.flags).toHaveProperty('force')
    expect(DeleteBranch.flags).toHaveProperty('remove-worktree')
    expect(DeleteBranch.flags).toHaveProperty('json')
    expect(DeleteBranch.flags.name.required).toBe(true)
    expect(DeleteBranch.flags.force.default).toBe(false)
    expect(DeleteBranch.flags['remove-worktree'].default).toBe(false)
    expect(DeleteBranch.examples).toHaveLength(3)
  })

  it('should delete a merged branch', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': false, json: false },
      args: {},
    } as any)

    await command.run()

    // Assert
    expect(mockGitHelper.isRepository).toHaveBeenCalled()
    expect(mockGitHelper.branchExists).toHaveBeenCalledWith('feature-x')
    expect(mockGitHelper.getCurrentBranch).toHaveBeenCalled()
    expect(mockGitHelper.isBranchMerged).toHaveBeenCalledWith('feature-x')
    expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('feature-x', false)
    expect(mockGitHelper.findWorktreeByBranch).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalled()
  })

  it('should error when not in a git repository', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(false),
      branchExists: vi.fn(),
      getCurrentBranch: vi.fn(),
      isBranchMerged: vi.fn(),
      deleteBranch: vi.fn(),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': false, json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith('Not a git repository', { exit: false })
  })

  it('should error when branch does not exist', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      getCurrentBranch: vi.fn(),
      isBranchMerged: vi.fn(),
      deleteBranch: vi.fn(),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'nonexistent', force: false, 'remove-worktree': false, json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith("Branch 'nonexistent' does not exist", { exit: false })
  })

  it('should error when trying to delete current branch', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('feature-x'),
      isBranchMerged: vi.fn(),
      deleteBranch: vi.fn(),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': false, json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      "Cannot delete the currently checked out branch 'feature-x'",
      { exit: false }
    )
  })

  it('should prevent deleting unmerged branch without --force', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn(),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'unmerged', force: false, 'remove-worktree': false, json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      "Branch 'unmerged' is not fully merged. Use --force to delete anyway.",
      { exit: false }
    )
    expect(mockGitHelper.deleteBranch).not.toHaveBeenCalled()
  })

  it('should force delete unmerged branch when --force is set', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with force
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'unmerged', force: true, 'remove-worktree': false, json: false },
      args: {},
    } as any)

    await command.run()

    // Assert - should skip merge check and delete with force
    expect(mockGitHelper.isBranchMerged).not.toHaveBeenCalled()
    expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('unmerged', true)
    expect(logSpy).toHaveBeenCalled()
  })

  it('should remove worktree when --remove-worktree is set', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn().mockResolvedValue({
        path: '../feature-worktree',
        branch: 'feature-x',
        commit: 'abc123',
        isPrunable: false,
      }),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with remove-worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': true, json: false },
      args: {},
    } as any)

    await command.run()

    // Assert - should find and remove worktree
    expect(mockGitHelper.findWorktreeByBranch).toHaveBeenCalledWith('feature-x')
    expect(mockGitHelper.hasUncommittedChanges).toHaveBeenCalledWith('../feature-worktree')
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('../feature-worktree', false)
    expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('feature-x', false)
    expect(logSpy).toHaveBeenCalled()
  })

  it('should error when worktree has uncommitted changes without --force', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn(),
      findWorktreeByBranch: vi.fn().mockResolvedValue({
        path: '../feature-worktree',
        branch: 'feature-x',
        commit: 'abc123',
        isPrunable: false,
      }),
      hasUncommittedChanges: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with remove-worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': true, json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
      "Worktree at '../feature-worktree' has uncommitted changes. Use --force to remove anyway.",
      { exit: false }
    )
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
    expect(mockGitHelper.deleteBranch).not.toHaveBeenCalled()
  })

  it('should force remove worktree with uncommitted changes when --force is set', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn().mockResolvedValue({
        path: '../feature-worktree',
        branch: 'feature-x',
        commit: 'abc123',
        isPrunable: false,
      }),
      hasUncommittedChanges: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with force and remove-worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: true, 'remove-worktree': true, json: false },
      args: {},
    } as any)

    await command.run()

    // Assert - should force remove worktree and branch
    expect(mockGitHelper.hasUncommittedChanges).toHaveBeenCalledWith('../feature-worktree')
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('../feature-worktree', true)
    expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('feature-x', true)
    expect(logSpy).toHaveBeenCalled()
  })

  it('should not error when worktree does not exist with --remove-worktree', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn().mockResolvedValue(null),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with remove-worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': true, json: false },
      args: {},
    } as any)

    await command.run()

    // Assert - should not error, just skip worktree removal
    expect(mockGitHelper.findWorktreeByBranch).toHaveBeenCalledWith('feature-x')
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
    expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('feature-x', false)
    expect(logSpy).toHaveBeenCalled()
  })

  it('should handle json output flag', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return json flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': false, json: true },
      args: {},
    } as any)

    await command.run()

    // Assert JSON output
    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls[0][0]
    const parsed = JSON.parse(output)

    expect(parsed).toEqual({
      status: 'success',
      branch: {
        name: 'feature-x',
        deleted: true,
        forced: false,
      },
    })
  })

  it('should include worktree in json output when removed', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn().mockResolvedValue({
        path: '../feature-worktree',
        branch: 'feature-x',
        commit: 'abc123',
        isPrunable: false,
      }),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return json flag with remove-worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': true, json: true },
      args: {},
    } as any)

    await command.run()

    // Assert JSON output includes worktree
    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls[0][0]
    const parsed = JSON.parse(output)

    expect(parsed).toEqual({
      status: 'success',
      branch: {
        name: 'feature-x',
        deleted: true,
        forced: false,
      },
      worktree: {
        path: '../feature-worktree',
        removed: true,
      },
    })
  })

  it('should include forced flag in json output when --force is set', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn(),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return json flag with force
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: true, 'remove-worktree': false, json: true },
      args: {},
    } as any)

    await command.run()

    // Assert JSON output includes forced flag
    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls[0][0]
    const parsed = JSON.parse(output)

    expect(parsed).toEqual({
      status: 'success',
      branch: {
        name: 'feature-x',
        deleted: true,
        forced: true,
      },
    })
  })

  it('should output error in json format when json flag is set', async () => {
    // Mock the GitHelper to throw error
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockRejectedValue(new Error('Git error occurred')),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return json flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': false, json: true },
      args: {},
    } as any)

    // Mock exit to not actually exit
    const exitSpy = vi.spyOn(command, 'exit').mockImplementation(() => {
      throw new Error('exit called')
    })

    await expect(command.run()).rejects.toThrow('exit called')

    // Assert JSON error output
    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls[0][0]
    const parsed = JSON.parse(output)

    expect(parsed).toEqual({
      status: 'error',
      error: 'Git error occurred',
    })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should handle errors from git operations', async () => {
    // Mock the GitHelper to throw error
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockRejectedValue(new Error('Cannot delete branch')),
      findWorktreeByBranch: vi.fn(),
      hasUncommittedChanges: vi.fn(),
      removeWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': false, json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith('Cannot delete branch', { exit: false })
  })

  it('should handle errors from worktree removal', async () => {
    // Mock the GitHelper with worktree error
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      isBranchMerged: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn(),
      findWorktreeByBranch: vi.fn().mockResolvedValue({
        path: '../feature-worktree',
        branch: 'feature-x',
        commit: 'abc123',
        isPrunable: false,
      }),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      removeWorktree: vi.fn().mockRejectedValue(new Error('Cannot remove worktree')),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with remove-worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'feature-x', force: false, 'remove-worktree': true, json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith('Cannot remove worktree', { exit: false })
    expect(mockGitHelper.deleteBranch).not.toHaveBeenCalled()
  })
})
