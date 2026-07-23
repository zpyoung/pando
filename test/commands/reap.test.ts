import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReapWorktree, {
  parseTtl,
  partitionReapClean,
  selectReapable,
  type ReapCandidate,
  type ReapSelectionWorktree,
} from '../../src/commands/reap.js'

const { mockGitHelper, mockEnumerateAll, mockStatus } = vi.hoisted(() => ({
  mockGitHelper: {
    setRetryConfig: vi.fn(),
    isRepository: vi.fn(),
    getRepositoryRoot: vi.fn(),
    getMainWorktreePath: vi.fn(),
    listWorktrees: vi.fn(),
    getWorktreeAgeMs: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    isReapClean: vi.fn(),
    removeWorktree: vi.fn(),
    branchExists: vi.fn(),
    deleteBranch: vi.fn(),
  },
  mockEnumerateAll: vi.fn(),
  mockStatus: vi.fn(),
}))

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({ status: mockStatus })),
}))

vi.mock('../../src/utils/git.js', () => ({
  GitHelper: vi.fn(() => mockGitHelper),
  createGitHelper: vi.fn(() => mockGitHelper),
}))

vi.mock('../../src/utils/worktreeMetadata.js', () => ({
  enumerateAll: mockEnumerateAll,
}))

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    worktree: { ephemeralTtl: '4h', targetBranch: 'main' },
    reap: { requireMerged: true },
    concurrency: { retry: { maxAttempts: 5, baseMs: 100, capMs: 2000 } },
  }),
}))

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }))

const now = Date.parse('2026-07-22T12:00:00.000Z')
const config = { worktree: { ephemeralTtl: '4h' } }

function selectionWorktree(
  path: string,
  overrides: Partial<ReapSelectionWorktree> = {}
): ReapSelectionWorktree {
  return {
    worktreePath: path,
    metadata: { kind: 'ephemeral', owner: 'session-a' },
    ageMs: 5 * 60 * 60 * 1000,
    branch: path.slice(1),
    ...overrides,
  }
}

function candidate(path: string): ReapCandidate {
  return { path, branch: path.slice(1), kind: 'ephemeral', ageMs: 20_000 }
}

describe('parseTtl', () => {
  it.each([
    ['90s', 90_000],
    ['30m', 1_800_000],
    ['4h', 14_400_000],
    ['2d', 172_800_000],
    ['1500', 1500],
  ])('parses %s', (ttl, expected) => {
    expect(parseTtl(ttl)).toBe(expected)
  })

  it.each(['', 'four hours', '4w', '-1h', '1h30m', 'Infinity'])('rejects %s', (ttl) => {
    expect(parseTtl(ttl)).toBeNull()
  })
})

describe('selectReapable', () => {
  it('applies the kind, age, lock, and owner selection matrix', () => {
    const worktrees = [
      selectionWorktree('/eligible'),
      selectionWorktree('/long-lived', { metadata: { kind: 'long-lived', owner: 'session-a' } }),
      selectionWorktree('/young', { ageMs: 60_000 }),
      selectionWorktree('/locked', { isLocked: true }),
      selectionWorktree('/other-owner', {
        metadata: { kind: 'ephemeral', owner: 'session-b' },
      }),
    ]

    expect(selectReapable(worktrees, { now, config, owner: 'session-a' })).toEqual([
      expect.objectContaining({ path: '/eligible', kind: 'ephemeral' }),
    ])
  })

  it('uses createdAt with now when an observed age is not provided', () => {
    const old = selectionWorktree('/old', {
      ageMs: undefined,
      metadata: {
        kind: 'ephemeral',
        createdAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
      },
    })

    expect(selectReapable([old], { now, config })).toHaveLength(1)
  })

  it('honors metadata TTL overrides and fails closed on invalid TTLs', () => {
    const expiredOverride = selectionWorktree('/override', {
      ageMs: 31 * 60 * 1000,
      metadata: { kind: 'ephemeral', ttl: '30m' },
    })
    const invalid = selectionWorktree('/invalid', {
      metadata: { kind: 'ephemeral', ttl: 'soon' },
    })

    expect(selectReapable([expiredOverride, invalid], { now, config })).toEqual([
      expect.objectContaining({ path: '/override' }),
    ])
  })

  it('requires age to be strictly greater than TTL', () => {
    const atTtl = selectionWorktree('/at-ttl', { ageMs: 4 * 60 * 60 * 1000 })
    expect(selectReapable([atTtl], { now, config })).toEqual([])
  })
})

describe('partitionReapClean', () => {
  it('partitions clean, dirty, unmerged, and errored candidates fail-closed', async () => {
    const dependencies = {
      hasUncommittedChanges: vi.fn(async (path: string) => {
        if (path === '/dirty') return true
        if (path === '/error') throw new Error('status unavailable')
        return false
      }),
      isReapClean: vi.fn(async (path: string) => path !== '/unmerged'),
    }

    const result = await partitionReapClean(
      [candidate('/clean'), candidate('/dirty'), candidate('/unmerged'), candidate('/error')],
      { targetBranch: 'main', requireMerged: true },
      dependencies
    )

    expect(result.clean.map(({ path }) => path)).toEqual(['/clean'])
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/dirty', reason: expect.stringContaining('dirty') }),
        expect.objectContaining({ path: '/unmerged', reason: expect.stringContaining('unmerged') }),
        expect.objectContaining({ path: '/error', reason: expect.stringContaining('failed') }),
      ])
    )
  })

  it('checks only uncommitted changes when merged branches are not required', async () => {
    const dependencies = {
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      isReapClean: vi.fn().mockResolvedValue(false),
    }

    const result = await partitionReapClean(
      [candidate('/unmerged-but-clean')],
      { targetBranch: 'main', requireMerged: false },
      dependencies
    )

    expect(result.clean).toHaveLength(1)
    expect(dependencies.isReapClean).not.toHaveBeenCalled()
  })
})

describe('reap command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGitHelper.isRepository.mockResolvedValue(true)
    mockGitHelper.getRepositoryRoot.mockResolvedValue('/repo')
    mockGitHelper.getMainWorktreePath.mockResolvedValue('/repo')
    mockGitHelper.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', commit: 'a', isPrunable: false },
      { path: '/wt/old', branch: 'old', commit: 'b', isPrunable: false },
      { path: '/wt/locked', branch: 'locked', commit: 'c', isPrunable: false, isLocked: true },
    ])
    mockEnumerateAll.mockResolvedValue([
      { worktreePath: '/repo', metadata: { kind: 'long-lived' } },
      { worktreePath: '/wt/old', metadata: { kind: 'ephemeral' } },
      { worktreePath: '/wt/locked', metadata: { kind: 'ephemeral' } },
    ])
    mockGitHelper.getWorktreeAgeMs.mockResolvedValue(5 * 60 * 60 * 1000)
    mockStatus.mockResolvedValue({ isClean: () => true })
    mockGitHelper.isReapClean.mockResolvedValue(true)
    mockGitHelper.removeWorktree.mockResolvedValue(undefined)
    mockGitHelper.branchExists.mockResolvedValue(true)
    mockGitHelper.deleteBranch.mockResolvedValue(undefined)
  })

  it('reaps only clean, expired, unlocked ephemeral worktrees in JSON mode', async () => {
    const command = new ReapWorktree(['--json'], {
      runHook: vi.fn().mockResolvedValue({ successes: [] }),
    } as never)
    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})

    await command.run()

    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/wt/old')
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalledWith('/wt/locked')
    expect(mockGitHelper.deleteBranch).toHaveBeenCalledWith('old')
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(payload.reaped).toEqual([expect.objectContaining({ path: '/wt/old' })])
    expect(payload.errors).toEqual([])
  })

  it('exits 1 after emitting one JSON document when only some removals fail', async () => {
    mockGitHelper.listWorktrees.mockResolvedValue([
      { path: '/repo', branch: 'main', commit: 'a', isPrunable: false },
      { path: '/wt/old', branch: 'old', commit: 'b', isPrunable: false },
      { path: '/wt/other', branch: 'other', commit: 'c', isPrunable: false },
    ])
    mockEnumerateAll.mockResolvedValue([
      { worktreePath: '/repo', metadata: { kind: 'long-lived' } },
      { worktreePath: '/wt/old', metadata: { kind: 'ephemeral' } },
      { worktreePath: '/wt/other', metadata: { kind: 'ephemeral' } },
    ])
    mockGitHelper.removeWorktree.mockImplementation(async (worktreePath: string) => {
      if (worktreePath === '/wt/old') throw new Error('removal failed')
    })
    const command = new ReapWorktree(['--json'], {
      runHook: vi.fn().mockResolvedValue({ successes: [] }),
    } as never)
    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})

    await expect(command.run()).rejects.toMatchObject({ oclif: { exit: 1 } })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(payload.status).toBe('success')
    expect(payload.reaped).toEqual([expect.objectContaining({ path: '/wt/other' })])
    expect(payload.errors).toEqual([
      expect.objectContaining({ path: '/wt/old', error: 'removal failed' }),
    ])
  })

  it('skips a worktree that was locked after candidate selection', async () => {
    mockGitHelper.listWorktrees
      .mockResolvedValueOnce([
        { path: '/repo', branch: 'main', commit: 'a', isPrunable: false },
        { path: '/wt/old', branch: 'old', commit: 'b', isPrunable: false },
      ])
      .mockResolvedValueOnce([
        { path: '/repo', branch: 'main', commit: 'a', isPrunable: false },
        {
          path: '/wt/old',
          branch: 'old',
          commit: 'b',
          isPrunable: false,
          isLocked: true,
        },
      ])
    mockEnumerateAll.mockResolvedValue([
      { worktreePath: '/repo', metadata: { kind: 'long-lived' } },
      { worktreePath: '/wt/old', metadata: { kind: 'ephemeral' } },
    ])
    const command = new ReapWorktree(['--json'], {
      runHook: vi.fn().mockResolvedValue({ successes: [] }),
    } as never)
    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})

    await command.run()

    expect(mockGitHelper.listWorktrees).toHaveBeenCalledTimes(2)
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(payload.skipped).toContainEqual({
      path: '/wt/old',
      reason: 'locked after selection',
    })
  })

  it('revalidates each candidate lock immediately before its removal', async () => {
    let secondLocked = false
    mockGitHelper.listWorktrees.mockImplementation(async () => [
      { path: '/repo', branch: 'main', commit: 'a', isPrunable: false },
      { path: '/wt/first', branch: 'first', commit: 'b', isPrunable: false },
      {
        path: '/wt/second',
        branch: 'second',
        commit: 'c',
        isPrunable: false,
        isLocked: secondLocked,
      },
    ])
    mockEnumerateAll.mockResolvedValue([
      { worktreePath: '/repo', metadata: { kind: 'long-lived' } },
      { worktreePath: '/wt/first', metadata: { kind: 'ephemeral' } },
      { worktreePath: '/wt/second', metadata: { kind: 'ephemeral' } },
    ])
    mockGitHelper.removeWorktree.mockImplementation(async (worktreePath: string) => {
      if (worktreePath === '/wt/first') secondLocked = true
    })
    const command = new ReapWorktree(['--json'], {
      runHook: vi.fn().mockResolvedValue({ successes: [] }),
    } as never)
    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})

    await command.run()

    expect(mockGitHelper.listWorktrees).toHaveBeenCalledTimes(3)
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledTimes(1)
    expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/wt/first')
    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalledWith('/wt/second')
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(payload.reaped).toEqual([expect.objectContaining({ path: '/wt/first' })])
    expect(payload.skipped).toContainEqual({
      path: '/wt/second',
      reason: expect.stringContaining('locked'),
    })
  })

  it('does not mutate anything during a dry run and reports unsafe candidates', async () => {
    mockStatus.mockResolvedValue({ isClean: () => false })
    const command = new ReapWorktree(['--dry-run', '--json'], {
      runHook: vi.fn().mockResolvedValue({ successes: [] }),
    } as never)
    const logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})

    await command.run()

    expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(payload.skipped[0].reason).toContain('dirty')
  })
})
