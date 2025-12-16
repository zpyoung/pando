import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoList, pandoAdd, pandoListHuman } from '../helpers/cli-runner.js'
import {
  expectSuccess,
  expectWorktreeList,
  expectWorktreeListHuman,
} from '../helpers/assertions.js'

describe('pando list (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
    repoPath = await setupGitRepo(container, {
      name: 'list-test-repo',
      files: [
        { path: 'package.json', content: '{"name": "test"}' },
        { path: 'src/index.ts', content: 'export const main = () => {}' },
      ],
    })
  })

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  describe('basic listing', () => {
    it('should list main worktree only', async () => {
      const result = await pandoList(container, repoPath)

      expectSuccess(result)
      expect(result.json?.worktrees).toBeDefined()
      expect(Array.isArray(result.json?.worktrees)).toBe(true)
      expect((result.json?.worktrees as unknown[]).length).toBeGreaterThanOrEqual(1)
    })

    it('should show main worktree path', async () => {
      const result = await pandoList(container, repoPath)

      expectSuccess(result)
      const worktrees = result.json?.worktrees as Array<{ path: string; branch: string }>
      const mainWorktree = worktrees.find((wt) => wt.path === repoPath)
      expect(mainWorktree).toBeDefined()
      expect(mainWorktree?.branch).toBe('main')
    })
  })

  describe('with multiple worktrees', () => {
    it('should list all worktrees after adding new ones', async () => {
      // Create two worktrees
      await pandoAdd(container, repoPath, [
        '--branch',
        'feature-list-1',
        '--path',
        '../worktrees/feature-list-1',
        '--skip-rsync',
      ])
      await pandoAdd(container, repoPath, [
        '--branch',
        'feature-list-2',
        '--path',
        '../worktrees/feature-list-2',
        '--skip-rsync',
      ])

      const result = await pandoList(container, repoPath)

      // Should have main + 2 created = 3 total
      expectWorktreeList(result, 3)
    })

    it('should include branch info for all worktrees', async () => {
      const result = await pandoList(container, repoPath)

      expectSuccess(result)
      const worktrees = result.json?.worktrees as Array<{ path: string; branch: string }>

      // All worktrees should have branch info (except detached HEAD)
      const withBranches = worktrees.filter((wt) => wt.branch !== null)
      expect(withBranches.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('detached HEAD worktrees', () => {
    it('should identify detached HEAD worktrees', async () => {
      // Create worktree from commit (detached HEAD)
      await pandoAdd(container, repoPath, [
        '--path',
        '../worktrees/detached-list',
        '--commit',
        'HEAD',
        '--skip-rsync',
      ])

      const result = await pandoList(container, repoPath)

      expectSuccess(result)
      const worktrees = result.json?.worktrees as Array<{ path: string; branch: string | null }>
      const detached = worktrees.find((wt) => wt.path.includes('detached-list'))

      expect(detached).toBeDefined()
      expect(detached?.branch).toBeNull()
    })
  })

  describe('error handling', () => {
    it('should fail when not in a git repository', async () => {
      await container.exec(['mkdir', '-p', '/tmp/not-a-repo'])

      const result = await pandoList(container, '/tmp/not-a-repo')

      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('human-readable output', () => {
    it('should display formatted worktree list with header and count', async () => {
      const result = await pandoListHuman(container, repoPath)

      // Comprehensive check: header, count, paths, branches, commits
      expectWorktreeListHuman(result, {
        minCount: 1,
        branches: ['main'],
      })
    })

    it('should show all worktree details with Branch labels and paths', async () => {
      const result = await pandoListHuman(container, repoPath)

      expectSuccess(result)
      const output = result.stdout

      // Must have "Found X worktree(s):" header
      expect(output).toMatch(/Found \d+ worktree/i)

      // Must show "Branch:" label
      expect(output.toLowerCase()).toContain('branch:')

      // Must show absolute paths
      expect(output).toContain('/repos/')
    })

    it('should show feature branch names in multi-worktree output', async () => {
      const result = await pandoListHuman(container, repoPath)

      expectWorktreeListHuman(result, {
        branches: ['main', 'feature-list-1', 'feature-list-2'],
      })
    })

    it('should indicate detached HEAD worktrees with special formatting', async () => {
      const result = await pandoListHuman(container, repoPath)

      expectWorktreeListHuman(result, {
        hasDetachedHead: true,
      })
    })
  })
})
