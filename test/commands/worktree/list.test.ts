import { describe, it, expect, beforeEach, vi } from 'vitest'
import ListWorktree from '../../../src/commands/worktree/list'
import * as gitUtils from '../../../src/utils/git'
import type { WorktreeInfo } from '../../../src/utils/git'

/**
 * Tests for worktree:list command
 *
 * These tests verify the command logic by mocking the GitHelper
 */

describe('worktree:list', () => {
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
      path: '/Users/test/repo-detached',
      branch: null,
      commit: '123abc456def',
      isPrunable: false,
    },
  ]

  const mockPrunableWorktrees: WorktreeInfo[] = [
    {
      path: '/Users/test/repo',
      branch: 'main',
      commit: 'abc123def456',
      isPrunable: false,
    },
    {
      path: '/Users/test/repo-deleted',
      branch: 'old-branch',
      commit: 'old123commit',
      isPrunable: true,
    },
  ]

  let command: ListWorktree
  let logSpy: any
  let errorSpy: any

  beforeEach(() => {
    // Reset all mocks before each test
    vi.restoreAllMocks()

    // Create command instance
    command = new ListWorktree([], {} as any)

    // Spy on log and error methods
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(command, 'error').mockImplementation(() => {
      throw new Error('Command error')
    })
  })

  it('should verify command exists and is properly configured', () => {
    expect(ListWorktree.description).toBe('List all git worktrees')
    expect(ListWorktree.flags).toHaveProperty('json')
    expect(ListWorktree.flags).toHaveProperty('verbose')
    expect(ListWorktree.examples).toHaveLength(3)
  })

  it('should list all worktrees successfully', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue(mockWorktrees),
    } as any)

    // Mock parse to return empty flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, verbose: false },
      args: {},
    } as any)

    await command.run()

    // Verify listWorktrees was called
    expect(logSpy).toHaveBeenCalled()

    // Verify output contains worktree count
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('Found 3 worktree(s)')
  })

  it('should output JSON format when --json flag is used', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue(mockWorktrees),
    } as any)

    // Mock parse to return json flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: true, verbose: false },
      args: {},
    } as any)

    await command.run()

    // Verify JSON output
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"worktrees"')
    )

    const jsonOutput = logSpy.mock.calls[0][0]
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.worktrees).toHaveLength(3)
  })

  it('should show verbose information when --verbose flag is set', async () => {
    // Mock the GitHelper
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue(mockWorktrees),
    } as any)

    // Mock parse to return verbose flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, verbose: true },
      args: {},
    } as any)

    await command.run()

    // Verify verbose output includes commits
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('Commit: abc123def456')
  })

  it('should handle empty worktree list', async () => {
    // Mock the GitHelper with empty list
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue([]),
    } as any)

    // Mock parse to return empty flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, verbose: false },
      args: {},
    } as any)

    await command.run()

    // Verify output handles empty list
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('No worktrees found')
  })

  it('should handle empty worktree list with --json flag', async () => {
    // Mock the GitHelper with empty list
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue([]),
    } as any)

    // Mock parse to return json flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: true, verbose: false },
      args: {},
    } as any)

    await command.run()

    // Verify JSON output with empty array
    const jsonOutput = logSpy.mock.calls[0][0]
    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toEqual({ worktrees: [] })
  })

  it('should show prunable worktrees (deleted paths)', async () => {
    // Mock the GitHelper with prunable worktree
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue(mockPrunableWorktrees),
    } as any)

    // Mock parse to return empty flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, verbose: false },
      args: {},
    } as any)

    await command.run()

    // Verify prunable warning is shown
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('⚠ Prunable')
  })

  it('should show detailed prunable status in verbose mode', async () => {
    // Mock the GitHelper with prunable worktree
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue(mockPrunableWorktrees),
    } as any)

    // Mock parse to return verbose flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, verbose: true },
      args: {},
    } as any)

    await command.run()

    // Verify detailed prunable status
    const calls = logSpy.mock.calls
    const outputs = calls.map((call: any) => call[0]).join('\n')
    expect(outputs).toContain('Status: prunable (directory deleted)')
  })

  it('should error when not in a git repository', async () => {
    // Mock the GitHelper to return false for isRepository
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(false),
      listWorktrees: vi.fn(),
    } as any)

    // Mock parse to return empty flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, verbose: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()

    // Verify error message
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not a git repository')
    )
  })

  it('should handle git errors gracefully', async () => {
    // Mock the GitHelper to throw an error
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue({
      isRepository: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockRejectedValue(new Error('Git command failed')),
    } as any)

    // Mock parse to return empty flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { json: false, verbose: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()

    // Verify error handling
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list worktrees')
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Git command failed')
    )
  })
})
