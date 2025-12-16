import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoAdd, pandoRemove, pandoList, pandoRemoveHuman } from '../helpers/cli-runner.js'
import {
  expectSuccess,
  expectJsonError,
  expectWorktreeRemoveHuman,
  expectErrorMessage,
} from '../helpers/assertions.js'

describe('pando remove (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
    repoPath = await setupGitRepo(container, {
      name: 'remove-test-repo',
      files: [{ path: 'README.md', content: '# Test' }],
    })
  })

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  describe('basic worktree removal', () => {
    it('should remove a worktree successfully', async () => {
      // Create worktree first
      await pandoAdd(container, repoPath, [
        '--branch',
        'to-remove-1',
        '--path',
        '../worktrees/to-remove-1',
        '--skip-rsync',
      ])

      // Remove it
      const result = await pandoRemove(container, repoPath, ['--path', '../worktrees/to-remove-1'])

      expectSuccess(result)
      expect(result.json?.success).toBe(true)

      // Verify it's gone from list
      const listResult = await pandoList(container, repoPath)
      const worktrees = listResult.json?.worktrees as Array<{ path: string }>
      const removed = worktrees.find((wt) => wt.path.includes('to-remove-1'))
      expect(removed).toBeUndefined()
    })

    it('should fail when worktree path does not exist', async () => {
      const result = await pandoRemove(container, repoPath, ['--path', '../worktrees/nonexistent'])

      expectJsonError(result, 'not found')
    })
  })

  describe('branch deletion options', () => {
    it('should delete local branch with --delete-branch local', async () => {
      // Create worktree
      await pandoAdd(container, repoPath, [
        '--branch',
        'delete-local-test',
        '--path',
        '../worktrees/delete-local-test',
        '--skip-rsync',
      ])

      // Remove with local branch deletion
      const result = await pandoRemove(container, repoPath, [
        '--path',
        '../worktrees/delete-local-test',
        '--delete-branch',
        'local',
        '--force',
      ])

      expectSuccess(result)
      expect(result.json?.branchDeletion?.localDeleted).toBe(true)

      // Verify branch is gone
      const branchCheck = await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && git branch --list delete-local-test`,
      ])
      expect(branchCheck.stdout.trim()).toBe('')
    })

    it('should keep branch with --keep-branch', async () => {
      // Create worktree
      await pandoAdd(container, repoPath, [
        '--branch',
        'keep-branch-test',
        '--path',
        '../worktrees/keep-branch-test',
        '--skip-rsync',
      ])

      // Remove with keep-branch
      const result = await pandoRemove(container, repoPath, [
        '--path',
        '../worktrees/keep-branch-test',
        '--keep-branch',
      ])

      expectSuccess(result)
      // Branch deletion might be skipped or not present in response
      expect(
        result.json?.branchDeletion?.skipped || result.json?.branchDeletion === undefined
      ).toBe(true)

      // Verify branch still exists
      const branchCheck = await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && git branch --list keep-branch-test`,
      ])
      expect(branchCheck.stdout.trim()).toContain('keep-branch-test')
    })
  })

  describe('uncommitted changes handling', () => {
    it('should fail without --force when worktree has uncommitted changes', async () => {
      // Create worktree
      await pandoAdd(container, repoPath, [
        '--branch',
        'dirty-wt',
        '--path',
        '../worktrees/dirty-wt',
        '--skip-rsync',
      ])

      // Make uncommitted changes (add to git index to make them "uncommitted")
      await container.exec([
        'sh',
        '-c',
        `cd ${repoPath}/../worktrees/dirty-wt && echo "dirty" > dirty.txt && git add dirty.txt`,
      ])

      // Try to remove without force
      const result = await pandoRemove(container, repoPath, ['--path', '../worktrees/dirty-wt'])

      // Should fail or report error about uncommitted changes
      const hasError =
        result.json?.success === false ||
        result.json?.error?.toLowerCase().includes('uncommitted') ||
        result.exitCode !== 0
      expect(hasError).toBe(true)
    })

    it('should succeed with --force when worktree has uncommitted changes', async () => {
      // Create worktree
      await pandoAdd(container, repoPath, [
        '--branch',
        'force-dirty',
        '--path',
        '../worktrees/force-dirty',
        '--skip-rsync',
      ])

      // Make uncommitted changes
      await container.exec([
        'sh',
        '-c',
        `echo "dirty" > ${repoPath}/../worktrees/force-dirty/dirty.txt`,
      ])

      // Remove with force
      const result = await pandoRemove(container, repoPath, [
        '--path',
        '../worktrees/force-dirty',
        '--force',
        '--keep-branch',
      ])

      expectSuccess(result)
      expect(result.json?.success).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should fail when not in a git repository', async () => {
      await container.exec(['mkdir', '-p', '/tmp/not-a-repo'])

      const result = await pandoRemove(container, '/tmp/not-a-repo', ['--path', './some-worktree'])

      // Should fail with non-zero exit code or error message
      const hasError =
        result.exitCode !== 0 ||
        result.json?.success === false ||
        (result.stderr + result.stdout).toLowerCase().includes('not a git repository')
      expect(hasError).toBe(true)
    })

    it('should require --path in JSON mode', async () => {
      const result = await pandoRemove(container, repoPath, [])

      // Should fail because no --path provided with --json
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('human-readable output', () => {
    it('should show success message with checkmark and removed path', async () => {
      // Create worktree first
      await pandoAdd(container, repoPath, [
        '--branch',
        'human-remove-1',
        '--path',
        '../worktrees/human-remove-1',
        '--skip-rsync',
      ])

      // Remove it with human output
      const result = await pandoRemoveHuman(container, repoPath, [
        '--path',
        '../worktrees/human-remove-1',
        '--keep-branch',
      ])

      // Comprehensive check: ✓, "removed", path
      expectWorktreeRemoveHuman(result, {
        pathContains: 'human-remove-1',
      })
    })

    it('should show removed worktree path and success message', async () => {
      // Create worktree first
      await pandoAdd(container, repoPath, [
        '--branch',
        'human-remove-2',
        '--path',
        '../worktrees/human-remove-2',
        '--skip-rsync',
      ])

      // Remove it with human output
      const result = await pandoRemoveHuman(container, repoPath, [
        '--path',
        '../worktrees/human-remove-2',
        '--keep-branch',
      ])

      expectSuccess(result)
      const output = result.stdout

      // Must have checkmark
      expect(output).toContain('✓')

      // Must show "removed" message
      expect(output.toLowerCase()).toContain('removed')

      // Must show the worktree path
      expect(output).toContain('human-remove-2')
    })

    it('should show branch deletion message with branch name when deleted', async () => {
      // Create worktree first
      await pandoAdd(container, repoPath, [
        '--branch',
        'human-remove-branch',
        '--path',
        '../worktrees/human-remove-branch',
        '--skip-rsync',
      ])

      // Remove with branch deletion
      const result = await pandoRemoveHuman(container, repoPath, [
        '--path',
        '../worktrees/human-remove-branch',
        '--delete-branch',
        'local',
        '--force',
      ])

      expectWorktreeRemoveHuman(result, {
        pathContains: 'human-remove-branch',
        branchDeleted: 'human-remove-branch',
      })
    })

    it('should show error message with not found for nonexistent path', async () => {
      const result = await pandoRemoveHuman(container, repoPath, [
        '--path',
        '../worktrees/human-nonexistent',
      ])

      expectErrorMessage(result, 'not found')
    })
  })
})
