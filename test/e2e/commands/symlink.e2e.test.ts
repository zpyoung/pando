import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoAdd, pandoSymlink, runPando, pandoSymlinkHuman } from '../helpers/cli-runner.js'
import { expectSuccess, expectSymlinkHuman, expectErrorMessage } from '../helpers/assertions.js'

describe('pando symlink (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
    repoPath = await setupGitRepo(container, {
      name: 'symlink-test-repo',
      files: [
        { path: 'package.json', content: '{"name": "test"}' },
        { path: 'src/index.ts', content: 'export const main = () => {}' },
      ],
    })

    // Create a worktree to test symlink command
    await pandoAdd(container, repoPath, [
      '--branch',
      'symlink-cmd-test',
      '--path',
      '../worktrees/symlink-cmd-test',
      '--skip-rsync',
      '--skip-symlink',
    ])
  })

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  describe('basic symlink creation', () => {
    it('should move file to main worktree and create symlink', async () => {
      const worktreePath = `${repoPath}/../worktrees/symlink-cmd-test`

      // Create a file in the worktree
      await container.exec(['sh', '-c', `echo "local content" > ${worktreePath}/local-file.txt`])

      // Run symlink command from worktree
      const result = await pandoSymlink(container, worktreePath, ['local-file.txt'])

      expectSuccess(result)

      // Verify symlink was created
      const linkCheck = await container.exec(['sh', '-c', `ls -la ${worktreePath}/local-file.txt`])
      expect(linkCheck.stdout).toContain('->')

      // Verify file exists in main worktree
      const mainFileCheck = await container.exec(['cat', `${repoPath}/local-file.txt`])
      expect(mainFileCheck.stdout).toContain('local content')
    })

    it('should create symlink for nested file', async () => {
      const worktreePath = `${repoPath}/../worktrees/symlink-cmd-test`

      // Create a nested file in the worktree
      await container.exec(['mkdir', '-p', `${worktreePath}/config`])
      await container.exec([
        'sh',
        '-c',
        `echo "config content" > ${worktreePath}/config/settings.json`,
      ])

      // Run symlink command
      const result = await pandoSymlink(container, worktreePath, ['config/settings.json'])

      expectSuccess(result)

      // Verify symlink was created
      const linkCheck = await container.exec([
        'sh',
        '-c',
        `ls -la ${worktreePath}/config/settings.json`,
      ])
      expect(linkCheck.stdout).toContain('->')
    })
  })

  describe('error handling', () => {
    it('should fail when file does not exist', async () => {
      const worktreePath = `${repoPath}/../worktrees/symlink-cmd-test`

      const result = await pandoSymlink(container, worktreePath, ['nonexistent.txt'])

      // Should fail with non-zero exit code or error
      expect(
        result.exitCode !== 0 || result.json?.success === false || result.stderr.length > 0
      ).toBe(true)
    })

    it('should fail when run from main worktree', async () => {
      // Create a file in main worktree
      await container.exec(['sh', '-c', `echo "main content" > ${repoPath}/main-file.txt`])

      const result = await pandoSymlink(container, repoPath, ['main-file.txt'])

      // Should fail because you can't symlink from main worktree
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('dry-run mode', () => {
    it('should not create symlink with --dry-run', async () => {
      // Create a new worktree for this test
      await pandoAdd(container, repoPath, [
        '--branch',
        'dry-run-test',
        '--path',
        '../worktrees/dry-run-test',
        '--skip-rsync',
        '--skip-symlink',
      ])

      const worktreePath = `${repoPath}/../worktrees/dry-run-test`

      // Create a file
      await container.exec([
        'sh',
        '-c',
        `echo "dry run content" > ${worktreePath}/dry-run-file.txt`,
      ])

      // Run symlink with --dry-run (not using JSON output for dry-run)
      const result = await runPando(container, {
        command: 'symlink',
        args: ['dry-run-file.txt', '--dry-run'],
        cwd: worktreePath,
        json: false,
      })

      expectSuccess(result)
      expect(result.stdout.toLowerCase()).toContain('dry')

      // File should still be a regular file, not symlink
      const linkCheck = await container.exec([
        'sh',
        '-c',
        `ls -la ${worktreePath}/dry-run-file.txt`,
      ])
      expect(linkCheck.stdout).not.toContain('->')
    })
  })

  describe('human-readable output', () => {
    it('should show complete symlink output with Moved, Source, Dest, and Created symlink', async () => {
      // Create a new worktree for this test
      await pandoAdd(container, repoPath, [
        '--branch',
        'human-symlink-1',
        '--path',
        '../worktrees/human-symlink-1',
        '--skip-rsync',
        '--skip-symlink',
      ])

      const worktreePath = `${repoPath}/../worktrees/human-symlink-1`

      // Create a file
      await container.exec([
        'sh',
        '-c',
        `echo "human symlink content" > ${worktreePath}/human-file.txt`,
      ])

      // Run symlink with human output
      const result = await pandoSymlinkHuman(container, worktreePath, ['human-file.txt'])

      // Comprehensive check: ✓, Moved, Source:, Dest:, Created symlink
      expectSymlinkHuman(result, {
        fileName: 'human-file.txt',
      })
    })

    it('should show Moved message with Source and Dest paths', async () => {
      // Create a new worktree for this test
      await pandoAdd(container, repoPath, [
        '--branch',
        'human-symlink-2',
        '--path',
        '../worktrees/human-symlink-2',
        '--skip-rsync',
        '--skip-symlink',
      ])

      const worktreePath = `${repoPath}/../worktrees/human-symlink-2`

      // Create a file
      await container.exec(['sh', '-c', `echo "moved content" > ${worktreePath}/moved-file.txt`])

      // Run symlink with human output
      const result = await pandoSymlinkHuman(container, worktreePath, ['moved-file.txt'])

      expectSuccess(result)
      const output = result.stdout

      // Must have checkmark
      expect(output).toContain('✓')

      // Must show "Moved" message
      expect(output.toLowerCase()).toContain('moved')

      // Must show Source: and Dest: paths
      expect(output.toLowerCase()).toContain('source:')
      expect(output.toLowerCase()).toContain('dest:')

      // Must show "Created symlink"
      expect(output.toLowerCase()).toContain('created symlink')
    })

    it('should show dry-run format with Move, To, and Link', async () => {
      // Create a new worktree for this test
      await pandoAdd(container, repoPath, [
        '--branch',
        'human-dry-run',
        '--path',
        '../worktrees/human-dry-run',
        '--skip-rsync',
        '--skip-symlink',
      ])

      const worktreePath = `${repoPath}/../worktrees/human-dry-run`

      // Create a file
      await container.exec(['sh', '-c', `echo "dry run human" > ${worktreePath}/dry-human.txt`])

      // Run symlink with dry-run
      const result = await pandoSymlinkHuman(container, worktreePath, [
        'dry-human.txt',
        '--dry-run',
      ])

      // Comprehensive dry-run check: "Dry run:", Move:, To:, Link:
      expectSymlinkHuman(result, {
        fileName: 'dry-human.txt',
        isDryRun: true,
      })
    })

    it('should show error for nonexistent file', async () => {
      const worktreePath = `${repoPath}/../worktrees/symlink-cmd-test`

      const result = await pandoSymlinkHuman(container, worktreePath, ['nonexistent-human.txt'])

      expectErrorMessage(result)
    })
  })
})
