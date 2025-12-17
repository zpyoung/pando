import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoBranchBackup, pandoBranchBackupHuman } from '../helpers/cli-runner.js'
import {
  expectSuccess,
  expectJsonSuccess,
  expectSuccessMessage,
  expectJsonError,
} from '../helpers/assertions.js'

describe('pando branch backup (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
  })

  // Create a fresh repo before each test to ensure clean state and avoid timestamp collisions
  beforeEach(async () => {
    const uniqueName = `backup-test-repo-${Date.now()}`
    repoPath = await setupGitRepo(container, {
      name: uniqueName,
      files: [
        { path: 'README.md', content: '# Test Repo' },
        { path: 'src/index.ts', content: 'export const main = () => {}' },
      ],
      branches: ['feature-branch', 'develop'],
      commits: 3,
    })
  })

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  describe('basic backup creation', () => {
    it('should create backup of current branch with JSON output', async () => {
      const result = await pandoBranchBackup(container, repoPath, [])

      expectJsonSuccess(result)
      expect(result.json?.backup).toBeDefined()

      const backup = result.json?.backup as {
        name: string
        sourceBranch: string
        commit: string
        timestamp: string
      }

      // Backup name should follow pattern: backup/<branch>/<timestamp>
      expect(backup.name).toMatch(/^backup\/main\/\d{8}-\d{6}$/)
      expect(backup.sourceBranch).toBe('main')
      expect(backup.commit).toMatch(/^[a-f0-9]{40}$/)
      expect(backup.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    })

    it('should create backup with a message', async () => {
      const message = 'BeforeRefactor'
      const result = await pandoBranchBackup(container, repoPath, ['--message', message])

      expectJsonSuccess(result)
      expect(result.json?.backup).toBeDefined()

      const backup = result.json?.backup as {
        name: string
        message?: string
      }

      expect(backup.message).toBe(message)
    })

    it('should create backup of a specific branch', async () => {
      const result = await pandoBranchBackup(container, repoPath, ['--branch', 'feature-branch'])

      expectJsonSuccess(result)
      expect(result.json?.backup).toBeDefined()

      const backup = result.json?.backup as {
        name: string
        sourceBranch: string
      }

      expect(backup.name).toMatch(/^backup\/feature-branch\/\d{8}-\d{6}$/)
      expect(backup.sourceBranch).toBe('feature-branch')
    })

    it('should verify backup branch exists in git', async () => {
      const result = await pandoBranchBackup(container, repoPath, [])

      expectJsonSuccess(result)
      const backupName = (result.json?.backup as { name: string }).name

      // Verify the backup branch actually exists
      const branchCheck = await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && git branch --list '${backupName}'`,
      ])

      expect(branchCheck.exitCode).toBe(0)
      expect(branchCheck.stdout.trim()).toContain(backupName.replace('backup/', ''))
    })

    it('should create backup that points to correct commit', async () => {
      // Get current HEAD commit
      const headResult = await container.exec(['sh', '-c', `cd ${repoPath} && git rev-parse HEAD`])
      const headCommit = headResult.stdout.trim()

      const result = await pandoBranchBackup(container, repoPath, [])

      expectJsonSuccess(result)
      const backup = result.json?.backup as { name: string; commit: string }

      // Verify backup points to same commit as HEAD
      expect(backup.commit).toBe(headCommit)

      // Double-check by resolving the backup branch
      const backupCommitResult = await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && git rev-parse '${backup.name}'`,
      ])
      expect(backupCommitResult.stdout.trim()).toBe(headCommit)
    })
  })

  describe('human-readable output', () => {
    it('should show success message with checkmark', async () => {
      const result = await pandoBranchBackupHuman(container, repoPath, [])

      expectSuccess(result)
      expectSuccessMessage(result)

      // Should show backup name
      expect(result.stdout).toMatch(/backup\/main\/\d{8}-\d{6}/)

      // Should show source branch info
      expect(result.stdout.toLowerCase()).toContain('source branch')
      expect(result.stdout).toContain('main')

      // Should show commit info (7-char hash)
      expect(result.stdout.toLowerCase()).toContain('commit')
    })

    it('should show message when provided', async () => {
      const message = 'ImportantCheckpoint'
      const result = await pandoBranchBackupHuman(container, repoPath, ['--message', message])

      expectSuccess(result)
      expect(result.stdout).toContain(message)
    })

    it('should show restore hint', async () => {
      const result = await pandoBranchBackupHuman(container, repoPath, [])

      expectSuccess(result)
      expect(result.stdout.toLowerCase()).toContain('restore')
      expect(result.stdout).toContain('pando branch restore')
    })
  })

  describe('error handling', () => {
    it('should fail when not in a git repository', async () => {
      await container.exec(['mkdir', '-p', '/tmp/not-a-repo'])

      const result = await pandoBranchBackup(container, '/tmp/not-a-repo', [])

      expectJsonError(result, 'not a git repository')
    })

    it('should fail when specifying non-existent branch', async () => {
      const result = await pandoBranchBackup(container, repoPath, [
        '--branch',
        'non-existent-branch',
      ])

      expectJsonError(result, 'does not exist')
    })

    it('should fail on detached HEAD without --branch flag', async () => {
      // Create a detached HEAD state
      await container.exec(['sh', '-c', `cd ${repoPath} && git checkout --detach HEAD`])

      const result = await pandoBranchBackup(container, repoPath, [])

      expectJsonError(result, 'detached')

      // Restore to main branch
      await container.exec(['sh', '-c', `cd ${repoPath} && git checkout main`])
    })

    it('should succeed on detached HEAD with --branch flag', async () => {
      // Create a detached HEAD state
      await container.exec(['sh', '-c', `cd ${repoPath} && git checkout --detach HEAD`])

      const result = await pandoBranchBackup(container, repoPath, ['--branch', 'develop'])

      expectJsonSuccess(result)
      expect((result.json?.backup as { sourceBranch: string }).sourceBranch).toBe('develop')

      // Restore to main branch
      await container.exec(['sh', '-c', `cd ${repoPath} && git checkout main`])
    })
  })

  describe('multiple backups', () => {
    it('should create multiple unique backups over time', async () => {
      // Create first backup
      const result1 = await pandoBranchBackup(container, repoPath, [])
      expectJsonSuccess(result1)
      const backup1Name = (result1.json?.backup as { name: string }).name

      // Wait a second to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Create second backup
      const result2 = await pandoBranchBackup(container, repoPath, [])
      expectJsonSuccess(result2)
      const backup2Name = (result2.json?.backup as { name: string }).name

      // Backups should have different names (different timestamps)
      expect(backup1Name).not.toBe(backup2Name)

      // Both should exist
      const listResult = await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && git branch --list 'backup/main/*'`,
      ])
      expect(listResult.stdout).toContain(backup1Name.replace('backup/', ''))
      expect(listResult.stdout).toContain(backup2Name.replace('backup/', ''))
    })
  })
})
