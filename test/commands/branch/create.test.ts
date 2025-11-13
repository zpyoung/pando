import { describe, it, expect, vi, beforeEach } from 'vitest'
import CreateBranch from '../../../src/commands/branch/create.js'
import * as gitUtils from '../../../src/utils/git.js'

/**
 * Tests for branch create command
 *
 * Tests cover all core functionality including:
 * - Creating new branches
 * - Validating required flags
 * - Creating branches from specific base refs
 * - Worktree integration
 * - JSON output format
 * - Error handling
 */

describe('branch create', () => {
  let command: CreateBranch
  let logSpy: any
  let errorSpy: any

  beforeEach(() => {
    // Reset all mocks before each test
    vi.restoreAllMocks()

    // Create command instance
    command = new CreateBranch([], {} as any)

    // Spy on log and error methods
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(command, 'error').mockImplementation(() => {
      throw new Error('Command error')
    })
  })

  it('should verify command exists and is properly configured', () => {
    expect(CreateBranch.description).toBe('Create a new git branch')
    expect(CreateBranch.flags).toHaveProperty('name')
    expect(CreateBranch.flags).toHaveProperty('from')
    expect(CreateBranch.flags).toHaveProperty('worktree')
    expect(CreateBranch.flags).toHaveProperty('json')
    expect(CreateBranch.flags.name.required).toBe(true)
    expect(CreateBranch.flags.from.default).toBe('main')
    expect(CreateBranch.examples).toHaveLength(3)
  })

  it('should create a new branch with default base', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockResolvedValue({
        name: 'test-branch',
        current: false,
        commit: 'abc123def456',
        label: 'test-branch',
      }),
      addWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'main', json: false },
      args: {},
    } as any)

    await command.run()

    // Assert
    expect(mockGitHelper.isRepository).toHaveBeenCalled()
    expect(mockGitHelper.branchExists).toHaveBeenCalledWith('test-branch')
    expect(mockGitHelper.createBranch).toHaveBeenCalledWith('test-branch', 'main')
    expect(mockGitHelper.addWorktree).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalled()
  })

  it('should error when not in a git repository', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(false),
      branchExists: vi.fn(),
      createBranch: vi.fn(),
      addWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'main', json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith('Not a git repository')
  })

  it('should error when branch already exists', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(true),
      createBranch: vi.fn(),
      addWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'existing-branch', from: 'main', json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith("Branch 'existing-branch' already exists")
  })

  it('should create branch from specified base', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockResolvedValue({
        name: 'test-branch',
        current: false,
        commit: 'abc123def456',
        label: 'test-branch',
      }),
      addWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with custom base
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'develop', json: false },
      args: {},
    } as any)

    await command.run()

    // Assert createBranch was called with develop
    expect(mockGitHelper.createBranch).toHaveBeenCalledWith('test-branch', 'develop')
  })

  it('should create worktree when flag is set', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockResolvedValue({
        name: 'test-branch',
        current: false,
        commit: 'abc123def456',
        label: 'test-branch',
      }),
      addWorktree: vi.fn().mockResolvedValue({
        path: '../test-worktree',
        branch: 'test-branch',
        commit: 'abc123def456',
        isPrunable: false,
      }),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'main', worktree: '../test-worktree', json: false },
      args: {},
    } as any)

    await command.run()

    // Assert both branch and worktree were created
    expect(mockGitHelper.createBranch).toHaveBeenCalledWith('test-branch', 'main')
    expect(mockGitHelper.addWorktree).toHaveBeenCalledWith('../test-worktree', {
      branch: 'test-branch',
    })
  })

  it('should handle json output flag', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockResolvedValue({
        name: 'test-branch',
        current: false,
        commit: 'abc123def456',
        label: 'test-branch',
      }),
      addWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return json flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'main', json: true },
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
        name: 'test-branch',
        commit: 'abc123def456',
        from: 'main',
      },
    })
  })

  it('should include worktree in json output when created', async () => {
    // Mock the GitHelper
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockResolvedValue({
        name: 'test-branch',
        current: false,
        commit: 'abc123def456',
        label: 'test-branch',
      }),
      addWorktree: vi.fn().mockResolvedValue({
        path: '../test-worktree',
        branch: 'test-branch',
        commit: 'abc123def456',
        isPrunable: false,
      }),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return json flag with worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'main', worktree: '../test-worktree', json: true },
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
        name: 'test-branch',
        commit: 'abc123def456',
        from: 'main',
      },
      worktree: {
        path: '../test-worktree',
        branch: 'test-branch',
        commit: 'abc123def456',
      },
    })
  })

  it('should output error in json format when json flag is set', async () => {
    // Mock the GitHelper to throw error
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockRejectedValue(new Error('Git error occurred')),
      addWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return json flag
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'main', json: true },
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
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockRejectedValue(new Error('Invalid base reference')),
      addWorktree: vi.fn(),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'invalid', json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith('Invalid base reference')
  })

  it('should handle errors from worktree creation', async () => {
    // Mock the GitHelper with worktree error
    const mockGitHelper = {
      isRepository: vi.fn().mockResolvedValue(true),
      branchExists: vi.fn().mockResolvedValue(false),
      createBranch: vi.fn().mockResolvedValue({
        name: 'test-branch',
        current: false,
        commit: 'abc123def456',
        label: 'test-branch',
      }),
      addWorktree: vi.fn().mockRejectedValue(new Error('Path already exists')),
    }
    vi.spyOn(gitUtils, 'createGitHelper').mockReturnValue(mockGitHelper as any)

    // Mock parse to return flags with worktree
    vi.spyOn(command, 'parse').mockResolvedValue({
      flags: { name: 'test-branch', from: 'main', worktree: '../existing-path', json: false },
      args: {},
    } as any)

    await expect(command.run()).rejects.toThrow()
    expect(errorSpy).toHaveBeenCalledWith('Path already exists')
  })
})
