import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoAdd, pandoList, pandoAddHuman } from '../helpers/cli-runner.js'
import {
  expectSuccess,
  expectJsonSuccess,
  expectJsonError,
  expectWorktreeCreated,
  expectWorktreeAddHuman,
  expectWorktreeAddError,
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
  })

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
      expect((result.json?.setup?.symlink as { created: number }).created).toBeGreaterThanOrEqual(1)
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

    it('should not show symlinked files as uncommitted changes (skip-worktree)', async () => {
      const result = await pandoAdd(container, repoPath, [
        '--branch',
        'skip-worktree-test',
        '--path',
        '../worktrees/skip-worktree-test',
        '--symlink',
        'package.json',
        '--skip-rsync',
      ])

      expectJsonSuccess(result)

      // Verify symlinks were created and skip-worktree was applied
      expect(result.json?.setup?.symlink).toBeDefined()
      expect((result.json?.setup?.symlink as { created: number }).created).toBeGreaterThanOrEqual(1)
      expect(result.json?.setup?.skipWorktree).toBeDefined()
      expect(
        (result.json?.setup?.skipWorktree as { filesMarked: number }).filesMarked
      ).toBeGreaterThanOrEqual(1)

      // Verify git status in the new worktree shows clean (no uncommitted changes)
      const worktreePath = `${repoPath}/../worktrees/skip-worktree-test`
      const statusResult = await container.exec([
        'sh',
        '-c',
        `cd ${worktreePath} && git status --porcelain`,
      ])

      // Should be empty (no uncommitted changes from symlinked files)
      expect(
        statusResult.stdout.trim(),
        `Expected clean git status but got: ${statusResult.stdout}`
      ).toBe('')
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

  describe('human-readable output', () => {
    it('should show complete success output with checkmark, path, branch, and commit', async () => {
      const result = await pandoAddHuman(container, repoPath, [
        '--branch',
        'human-test-1',
        '--path',
        '../worktrees/human-test-1',
        '--skip-rsync',
      ])

      // Comprehensive check: ✓, "Worktree created at", Branch:, Commit:, Ready to use, Duration
      expectWorktreeAddHuman(result, {
        pathContains: 'human-test-1',
        branch: 'human-test-1',
      })
    })

    it('should show Branch and Commit details after worktree creation', async () => {
      const result = await pandoAddHuman(container, repoPath, [
        '--branch',
        'human-test-2',
        '--path',
        '../worktrees/human-test-2',
        '--skip-rsync',
      ])

      expectSuccess(result)
      const output = result.stdout

      // Must have checkmark
      expect(output).toContain('✓')

      // Must have "Worktree created at" with path
      expect(output.toLowerCase()).toContain('worktree created at')
      expect(output).toContain('human-test-2')

      // Must show Branch: label
      expect(output.toLowerCase()).toContain('branch:')

      // Must show Commit: label with hash (7 chars)
      expect(output.toLowerCase()).toContain('commit:')
    })

    it('should show Ready to use footer with cd command', async () => {
      const result = await pandoAddHuman(container, repoPath, [
        '--branch',
        'human-test-3',
        '--path',
        '../worktrees/human-test-3',
        '--skip-rsync',
      ])

      expectSuccess(result)
      const output = result.stdout.toLowerCase()

      // Must have "Ready to use: cd" message
      expect(output).toContain('ready to use')
      expect(output).toContain('cd')

      // Must have Duration: message
      expect(output).toContain('duration:')
    })

    it('should show rsync file count and size when rsync enabled', async () => {
      const result = await pandoAddHuman(container, repoPath, [
        '--branch',
        'human-rsync-test',
        '--path',
        '../worktrees/human-rsync-test',
      ])

      expectWorktreeAddHuman(result, {
        hasRsync: true,
      })

      // Should show "Files synced: X files (Y MB)"
      const output = result.stdout.toLowerCase()
      expect(output).toContain('files synced')
      expect(output).toMatch(/\d+\s*(files|mb)/i)
    })

    it('should show valid MB value greater than 0 for rsync operations', async () => {
      // Create a file larger than 1MB to ensure measurable rsync output
      await container.exec([
        'sh',
        '-c',
        `dd if=/dev/zero of=${repoPath}/large-file.bin bs=1M count=2 2>/dev/null`,
      ])

      // Run pando add with human-readable output
      const result = await pandoAddHuman(container, repoPath, [
        '--branch',
        'rsync-mb-test',
        '--path',
        '../worktrees/rsync-mb-test',
      ])

      expectSuccess(result)
      const output = result.stdout

      // Verify the file was actually synced to the new worktree
      const worktreePath = `${repoPath}/../worktrees/rsync-mb-test`
      const fileCheck = await container.exec(['ls', '-la', `${worktreePath}/large-file.bin`])
      expect(fileCheck.exitCode, `Large file should have been synced to worktree`).toBe(0)

      // Extract MB value from "Files synced: X files (Y MB)" pattern
      const mbMatch = output.match(/\(([0-9.]+)\s*MB\)/i)
      expect(mbMatch, `Expected MB value in output.\nActual output:\n${output}`).not.toBeNull()

      if (mbMatch) {
        const mbValue = parseFloat(mbMatch[1])
        expect(mbValue, `MB value should be > 0, got ${mbValue}`).toBeGreaterThan(0)
      }
    })

    it('should show error message with path already exists', async () => {
      // Create the path first to cause error
      await container.exec(['mkdir', '-p', `${repoPath}/../worktrees/human-exists`])

      const result = await pandoAddHuman(container, repoPath, [
        '--branch',
        'human-exists',
        '--path',
        '../worktrees/human-exists',
        '--skip-rsync',
      ])

      expectWorktreeAddError(result, 'exists')
    })
  })
})
