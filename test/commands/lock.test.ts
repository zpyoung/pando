import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LockWorktree, { resolveLockTarget } from '../../src/commands/lock.js'
import type { WorktreeInfo } from '../../src/utils/git.js'

const mockGitHelper = {
  isRepository: vi.fn(),
  getRepositoryRoot: vi.fn(),
  listWorktrees: vi.fn(),
  lockWorktree: vi.fn(),
}

vi.mock('../../src/utils/git.js', () => ({
  GitHelper: vi.fn(() => mockGitHelper),
  createGitHelper: vi.fn(() => mockGitHelper),
}))

const worktrees: WorktreeInfo[] = [
  { path: '/repo', branch: 'main', commit: 'a', isPrunable: false },
  { path: '/repo/worktrees/feature', branch: 'feature/x', commit: 'b', isPrunable: false },
]

function createCommand(argv: string[]): LockWorktree {
  const command = new LockWorktree(argv, {
    runHook: vi.fn().mockResolvedValue({ successes: [] }),
  } as never)
  vi.spyOn(command, 'log').mockImplementation(() => {})
  vi.spyOn(command, 'error').mockImplementation(((message: string | Error) => {
    throw new Error(typeof message === 'string' ? message : message.message)
  }) as never)
  return command
}

describe('resolveLockTarget', () => {
  it('resolves paths relative to cwd and the repository', () => {
    expect(
      resolveLockTarget('../worktrees/feature', worktrees, '/repo', '/repo/subdir')?.path
    ).toBe('/repo/worktrees/feature')
    expect(resolveLockTarget('worktrees/feature', worktrees, '/repo', '/elsewhere')?.path).toBe(
      '/repo/worktrees/feature'
    )
  })

  it('canonicalizes symlinked paths before matching', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pando-lock-'))
    const actualPath = path.join(temporaryRoot, 'actual')
    const linkedPath = path.join(temporaryRoot, 'linked')

    try {
      mkdirSync(actualPath)
      symlinkSync(actualPath, linkedPath, 'dir')
      const symlinkedWorktrees: WorktreeInfo[] = [
        { path: actualPath, branch: 'feature/x', commit: 'b', isPrunable: false },
      ]

      expect(resolveLockTarget(linkedPath, symlinkedWorktrees, temporaryRoot)?.path).toBe(
        actualPath
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('resolves exact branch names', () => {
    expect(resolveLockTarget('feature/x', worktrees, '/repo')?.path).toBe('/repo/worktrees/feature')
  })
})

describe('lock command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')
    mockGitHelper.listWorktrees.mockResolvedValue(worktrees)
    mockGitHelper.lockWorktree.mockResolvedValue(undefined)
  })

  it('locks a worktree resolved from a path flag with a reason', async () => {
    const command = createCommand([
      '--path',
      'worktrees/feature',
      '--reason',
      'active session',
      '--json',
    ])

    await command.run()

    expect(mockGitHelper.lockWorktree).toHaveBeenCalledWith(
      '/repo/worktrees/feature',
      'active session'
    )
    expect(command.log).toHaveBeenCalledWith(expect.stringContaining('"locked": true'))
  })

  it('locks a worktree resolved from a positional branch name', async () => {
    const command = createCommand(['feature/x'])

    await command.run()

    expect(mockGitHelper.lockWorktree).toHaveBeenCalledWith('/repo/worktrees/feature', undefined)
  })

  it('rejects a target that is not an actual worktree', async () => {
    const command = createCommand(['missing'])

    await expect(command.run()).rejects.toThrow('Worktree not found')
    expect(mockGitHelper.lockWorktree).not.toHaveBeenCalled()
  })
})
