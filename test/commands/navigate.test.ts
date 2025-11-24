import { describe, it, expect, beforeEach, vi } from 'vitest'
import NavigateWorktree from '../../src/commands/navigate'
import * as gitUtils from '../../src/utils/git'
import type { WorktreeInfo } from '../../src/utils/git'

/**
 * Tests for navigate command
 *
 * These tests verify the command logic by mocking the GitHelper
 */

describe('navigate', () => {
  // Mock sample data
  const mockWorktrees: WorktreeInfo[] = [
    {
      path: '/Users/test/repo',
      branch: 'main',
      commit: 'abc123def456',
      isPrunable: false,
    },
    {
      path: '/Users/test/repo-feature',
      branch: 'feature/new-feature',
      commit: 'def456abc789',
      isPrunable: false,
    },
    {
      path: '/Users/test/repo-fix',
      branch: 'fix/bug-fix',
      commit: '789abc123def',
      isPrunable: false,
    },
  ]

  let command: NavigateWorktree
  let logSpy: any
  let errorSpy: any

  beforeEach(() => {
    // Reset all mocks before each test
    vi.restoreAllMocks()

    // Create command instance
    command = new NavigateWorktree([], {} as any)

    // Spy on log and error methods
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(command, 'error').mockImplementation(() => {
      throw new Error('Command error')
    })
  })

  it('should verify command exists and is properly configured', () => {
    expect(NavigateWorktree.description).toBe('Navigate to a git worktree')
    expect(NavigateWorktree.flags).toHaveProperty('json')
    expect(NavigateWorktree.flags).toHaveProperty('branch')
    expect(NavigateWorktree.flags).toHaveProperty('path')
    expect(NavigateWorktree.flags).toHaveProperty('output-path')
    expect(NavigateWorktree.examples).toHaveLength(3)
  })

  it('should navigate to worktree by branch (exact match)', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      findWorktreeByBranch: vi.fn().mockResolvedValue(mockWorktrees[1]),
    } as any)

    // Mock parse to return branch flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'feature/new-feature', json: false, 'output-path': false },
      args: {},
    } as any)

    await command.run()

    // Verify findWorktreeByBranch was called
    const gitHelper = gitUtils.createGitHelper()
    expect(gitHelper.findWorktreeByBranch).toHaveBeenCalledWith('feature/new-feature')

    // Verify output
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('/Users/test/repo-feature')
    expect(outputs).toContain('feature/new-feature')
  })

  it('should navigate to worktree by branch (fuzzy match)', async () => {
    // Mock the GitHelper with fuzzy match result
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      findWorktreeByBranch: vi.fn().mockResolvedValue(mockWorktrees[2]),
    } as any)

    // Mock parse to return partial branch name
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'bug', json: false, 'output-path': false },
      args: {},
    } as any)

    await command.run()

    // Verify findWorktreeByBranch was called
    const gitHelper = gitUtils.createGitHelper()
    expect(gitHelper.findWorktreeByBranch).toHaveBeenCalledWith('bug')

    // Verify output contains the matched worktree
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('fix/bug-fix')
  })

  it('should navigate to worktree by path', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue(mockWorktrees),
    } as any)

    // Mock parse to return path flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { path: '/Users/test/repo-feature', json: false, 'output-path': false },
      args: {},
    } as any)

    await command.run()

    // Verify listWorktrees was called
    const gitHelper = gitUtils.createGitHelper()
    expect(gitHelper.listWorktrees).toHaveBeenCalled()

    // Verify output
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('/Users/test/repo-feature')
    expect(outputs).toContain('feature/new-feature')
  })

  it('should require either branch or path flag', async () => {
    // Mock parse to return no flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, 'output-path': false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()

    // Verify error message
    expect(errorSpy).toHaveBeenCalledWith('Must specify either --branch or --path', { exit: false })
  })

  it('should output only path when --output-path flag is set', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      findWorktreeByBranch: vi.fn().mockResolvedValue(mockWorktrees[1]),
    } as any)

    // Mock parse to return branch and output-path flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'feature/new-feature', json: false, 'output-path': true },
      args: {},
    } as any)

    await command.run()

    // Verify only path is output (no additional text)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('/Users/test/repo-feature')
  })

  it('should handle json output flag', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      findWorktreeByBranch: vi.fn().mockResolvedValue(mockWorktrees[1]),
    } as any)

    // Mock parse to return branch and json flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'feature/new-feature', json: true, 'output-path': false },
      args: {},
    } as any)

    await command.run()

    // Verify JSON output
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"path"'))

    const jsonOutput = logSpy.mock.calls[0][0]
    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toEqual({
      path: '/Users/test/repo-feature',
      branch: 'feature/new-feature',
      commit: 'def456abc789',
      isPrunable: false,
    })
  })

  it('should error when worktree branch not found', async () => {
    // Mock the GitHelper to return null (not found)
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      findWorktreeByBranch: vi.fn().mockResolvedValue(null),
    } as any)

    // Mock parse to return branch flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'nonexistent', json: false, 'output-path': false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()

    // Verify error message
    expect(errorSpy).toHaveBeenCalledWith("Worktree for branch 'nonexistent' not found", {
      exit: false,
    })
  })

  it('should error when worktree path not found', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue(mockWorktrees),
    } as any)

    // Mock parse to return nonexistent path
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { path: '/nonexistent/path', json: false, 'output-path': false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()

    // Verify error message
    expect(errorSpy).toHaveBeenCalledWith("Worktree at path '/nonexistent/path' not found", {
      exit: false,
    })
  })

  it('should error when not in a git repository', async () => {
    // Mock the GitHelper to return false for isRepository
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(false),
    } as any)

    // Mock parse to return branch flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'main', json: false, 'output-path': false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()

    // Verify error message
    expect(errorSpy).toHaveBeenCalledWith('Not a git repository', { exit: false })
  })

  it('should handle git errors gracefully', async () => {
    // Mock the GitHelper to throw an error
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      findWorktreeByBranch: vi.fn().mockRejectedValue(new Error('Git command failed')),
    } as any)

    // Mock parse to return branch flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'main', json: false, 'output-path': false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()

    // Verify error handling
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to navigate to worktree'),
      { exit: false }
    )
  })

  it('should prioritize --output-path over --json flag', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      findWorktreeByBranch: vi.fn().mockResolvedValue(mockWorktrees[0]),
    } as any)

    // Mock parse to return both flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { branch: 'main', json: true, 'output-path': true },
      args: {},
    } as any)

    await command.run()

    // Verify only path is output (output-path takes precedence)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('/Users/test/repo')
  })

  it('should display detached branch status', async () => {
    // Mock worktree with detached HEAD
    const detachedWorktree: WorktreeInfo = {
      path: '/Users/test/repo-detached',
      branch: null,
      commit: '123abc456def',
      isPrunable: false,
    }

    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue([detachedWorktree]),
    } as any)

    // Mock parse to return path flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { path: '/Users/test/repo-detached', json: false, 'output-path': false },
      args: {},
    } as any)

    await command.run()

    // Verify detached status is shown
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('detached')
  })
})
