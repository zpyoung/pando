import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoAdd, pandoList } from '../helpers/cli-runner.js'
import {
  expectSuccess,
  expectJsonSuccess,
  expectJsonError,
  expectWorktreeCreated,
} from '../helpers/assertions.js'

describe('pando add (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
    repoPath = await setupGitRepo(container, {
      name: 'add-test-repo',
      files: [
        { path: 'package.json', content: '{"name": "test"}' },
        { path: 'src/index.ts', content: 'export const main = () => {}' },
        { path: 'node_modules/.bin/test', content: 'binary' },
      ],
      branches: ['existing-branch'],
    })
  }, 120000)

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  describe('basic worktree creation', () => {
    it('should create worktree with new branch', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'feature-add-1',
        '--path',
        '../worktrees/feature-add-1',
        '--skip-rsync',
      ])

      expectJsonSuccess(result)
      expectWorktreeCreated(result, 'feature-add-1', 'feature-add-1')
    })

    it('should create worktree from existing branch', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'existing-branch',
        '--path',
        '../worktrees/existing-branch',
        '--skip-rsync',
      ])

      expectJsonSuccess(result)
      expectWorktreeCreated(result, 'existing-branch', 'existing-branch')
    })

    it('should create worktree from specific commit (detached HEAD)', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--path',
        '../worktrees/detached-add',
        '--commit',
        'HEAD',
        '--skip-rsync',
      ])

      expectSuccess(result)
      expect(result.json?.success).toBe(true)
      expect(result.json?.worktree).toBeDefined()
      // Detached HEAD has null branch
      expect((result.json?.worktree as { branch: string | null }).branch).toBeNull()
    })

    it('should show worktree in list after creation', async () => {
      await pandoAdd(container, repoPath, [
        '--branch',
        'verify-list',
        '--path',
        '../worktrees/verify-list',
        '--skip-rsync',
      ])

      const listResult = await pandoList(container, repoPath)
      expectSuccess(listResult)

      const worktrees = listResult.json?.worktrees as Array<{ path: string; branch: string }>
      const created = worktrees.find((wt) => wt.branch === 'verify-list')
      expect(created).toBeDefined()
    })
  })

  describe('rsync integration', () => {
    it('should sync files with rsync enabled', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'rsync-test',
        '--path',
        '../worktrees/rsync-test',
      ])

      expectJsonSuccess(result)
      // rsync result should be present (not null/undefined)
      expect(result.json?.setup?.rsync).toBeDefined()
      expect(result.json?.setup?.rsync).not.toBeNull()
    })

    it('should skip rsync when --skip-rsync is set', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'no-rsync',
        '--path',
        '../worktrees/no-rsync',
        '--skip-rsync',
      ])

      expectJsonSuccess(result)
      expect(result.json?.setup?.rsync).toBeNull()
    })

    it('should apply rsync exclude patterns', async () => {
      // Verify rsync runs with exclude flag (actual exclusion depends on rsync behavior)
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'rsync-exclude',
        '--path',
        '../worktrees/rsync-exclude',
        '--rsync-exclude',
        'node_modules',
      ])

      expectJsonSuccess(result)
      expect(result.json?.setup?.rsync).toBeDefined()
    })
  })

  describe('symlink integration', () => {
    it('should create symlinks for specified patterns', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'symlink-test',
        '--path',
        '../worktrees/symlink-test',
        '--symlink',
        'package.json',
        '--skip-rsync',
      ])

      expectJsonSuccess(result)
      expect(result.json?.setup?.symlink).toBeDefined()
      expect(
        (result.json?.setup?.symlink as { created: number }).created
      ).toBeGreaterThanOrEqual(1)
    })

    it('should skip symlinks when --skip-symlink is set', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'no-symlink',
        '--path',
        '../worktrees/no-symlink',
        '--skip-rsync',
        '--skip-symlink',
      ])

      expectJsonSuccess(result)
      expect(result.json?.setup?.symlink).toBeNull()
    })
  })

  describe('force flag', () => {
    it('should reset existing branch with --force', async () => {
      // First create a worktree with a branch
      await pandoAdd(container, repoPath, [
        '--branch',
        'force-test-branch',
        '--path',
        '../worktrees/force-test-1',
        '--skip-rsync',
      ])

      // Remove the worktree but keep the branch
      await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && git worktree remove ../worktrees/force-test-1`,
      ])

      // Now create a new worktree with --force on the same branch
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'force-test-branch',
        '--path',
        '../worktrees/force-test-2',
        '--force',
        '--skip-rsync',
      ])

      expectJsonSuccess(result)
      expectWorktreeCreated(result, 'force-test-2', 'force-test-branch')
    })
  })

  describe('error handling', () => {
    it('should fail when path already exists', async () => {
      // Create the path first
      await container.exec(['mkdir', '-p', `${repoPath}/../worktrees/exists-test`])

      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'exists-test',
        '--path',
        '../worktrees/exists-test',
        '--skip-rsync',
      ])

      expectJsonError(result, 'already exists')
    })

    it('should fail when not in a git repository', async () => {
      await container.exec(['mkdir', '-p', '/tmp/not-a-repo'])

      const result = await pandoAdd(container, '/tmp/not-a-repo', [
        '--branch',
        'test',
        '--path',
        './worktree',
      ])

      expectJsonError(result, 'not a git repository')
    })

    it('should fail when neither --branch nor --path provided', async () => {
      const result = await pandoAdd(container, repoPath, [])

      expect(result.exitCode).not.toBe(0)
    })

    it('should fail when --force is used without --branch', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--path',
        '../worktrees/force-no-branch',
        '--force',
        '--skip-rsync',
      ])

      expectJsonError(result, '--force flag requires --branch')
    })
  })
})
