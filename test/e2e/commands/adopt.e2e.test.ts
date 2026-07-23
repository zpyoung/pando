import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoAdopt } from '../helpers/cli-runner.js'
import { expectJsonSuccess, expectJsonError } from '../helpers/assertions.js'

/**
 * E2E coverage for `pando adopt` — taking over a worktree created OUTSIDE pando
 * (raw `git worktree add`). Verifies the safety invariants against real git:
 * user work is never clobbered and the worktree is never removed.
 */
describe('pando adopt (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
    repoPath = await setupGitRepo(container, {
      name: 'adopt-test-repo',
      files: [
        { path: 'package.json', content: '{"name": "test"}' },
        { path: 'src/index.ts', content: 'export const main = () => {}' },
        { path: '.gitignore', content: 'node_modules/\n.venv/' },
        { path: 'node_modules/.bin/tool', content: 'binary' },
        { path: '.venv/cache.bin', content: 'artifact' },
      ],
    })
  })

  afterAll(async () => {
    if (container) await container.stop()
  })

  /** Create a linked worktree with raw git (not pando). */
  async function rawWorktree(name: string, branch: string): Promise<string> {
    const wtPath = `${repoPath}/../worktrees/${name}`
    await container.exec(['sh', '-c', `cd ${repoPath} && git worktree add -b ${branch} ${wtPath}`])
    return wtPath
  }

  describe('basic adoption', () => {
    it('adopts a raw worktree: writes metadata, syncs artifacts, stays clean', async () => {
      const wt = await rawWorktree('basic', 'adopt-basic')

      const result = await pandoAdopt(container, wt, [])
      expectJsonSuccess(result)
      expect(result.json?.adopted).toBe(true)
      expect((result.json?.worktree as { kind: string }).kind).toBe('long-lived')

      // pando metadata was stamped onto the worktree config.
      const meta = await container.exec([
        'sh',
        '-c',
        `cd ${wt} && git config --worktree --get-regexp '^pando\\.'`,
      ])
      expect(meta.stdout).toContain('pando.kind long-lived')

      // Gitignored artifact was synced from the main worktree.
      const artifact = await container.exec(['ls', `${wt}/node_modules/.bin/tool`])
      expect(artifact.exitCode).toBe(0)

      // git status is clean aside from pando's own additions.
      const status = await container.exec(['sh', '-c', `cd ${wt} && git status --porcelain`])
      expect(status.stdout.trim()).toBe('')
    })

    it('is idempotent: a second adopt re-applies and flags alreadyManaged', async () => {
      const wt = await rawWorktree('idem', 'adopt-idem')
      await pandoAdopt(container, wt, [])

      const again = await pandoAdopt(container, wt, [])
      expectJsonSuccess(again)
      expect(again.json?.alreadyManaged).toBe(true)
    })
  })

  describe('protects user work', () => {
    it('preserves uncommitted changes (tracked + untracked) when adopting a dirty worktree', async () => {
      const wt = await rawWorktree('dirty', 'adopt-dirty')
      await container.exec(['sh', '-c', `echo 'wip work' > ${wt}/UNTRACKED.txt`])
      await container.exec(['sh', '-c', `echo '{"name":"changed"}' > ${wt}/package.json`])

      const result = await pandoAdopt(container, wt, [])
      expectJsonSuccess(result)
      expect(result.json?.preexistingDirty).toEqual(
        expect.arrayContaining(['UNTRACKED.txt', 'package.json'])
      )

      // Both the untracked file and the modified tracked file survive untouched.
      const untracked = await container.exec(['cat', `${wt}/UNTRACKED.txt`])
      expect(untracked.stdout.trim()).toBe('wip work')
      const pkg = await container.exec(['cat', `${wt}/package.json`])
      expect(pkg.stdout).toContain('changed')
    })

    it('skips a symlink whose target holds a real file (default), preserving it', async () => {
      // Configure a symlink pattern for package.json, then put a real file there.
      await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && printf '[symlink]\\npatterns = ["package.json"]\\n' > .pando.toml`,
      ])
      const wt = await rawWorktree('conflict', 'adopt-conflict')
      await container.exec(['sh', '-c', `echo 'REAL LOCAL' > ${wt}/package.json`])

      const result = await pandoAdopt(container, wt, [])
      expectJsonSuccess(result)
      expect(
        (result.json?.setup as { symlink: { conflictCount: number } }).symlink.conflictCount
      ).toBe(1)

      // The real file is left in place (not replaced by a symlink).
      const check = await container.exec([
        'sh',
        '-c',
        `test -L ${wt}/package.json && echo LINK || echo FILE`,
      ])
      expect(check.stdout.trim()).toBe('FILE')
    })

    it('replaces the real file with a symlink under --replace-existing', async () => {
      await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && printf '[symlink]\\npatterns = ["package.json"]\\n' > .pando.toml`,
      ])
      const wt = await rawWorktree('replace', 'adopt-replace')
      await container.exec(['sh', '-c', `echo 'REAL LOCAL' > ${wt}/package.json`])

      const result = await pandoAdopt(container, wt, ['--replace-existing'])
      expectJsonSuccess(result)

      const check = await container.exec([
        'sh',
        '-c',
        `test -L ${wt}/package.json && echo LINK || echo FILE`,
      ])
      expect(check.stdout.trim()).toBe('LINK')

      // Clean up the config so it does not leak into later tests.
      await container.exec(['sh', '-c', `cd ${repoPath} && rm -f .pando.toml`])
    })
  })

  describe('dry run', () => {
    it('changes nothing and reports a plan', async () => {
      const wt = await rawWorktree('dry', 'adopt-dry')

      const result = await pandoAdopt(container, wt, ['--dry-run'])
      expectJsonSuccess(result)
      expect(result.json?.dryRun).toBe(true)
      expect(result.json?.plan).toBeDefined()

      // No metadata was written.
      const meta = await container.exec([
        'sh',
        '-c',
        `cd ${wt} && git config --worktree --get-regexp '^pando\\.' || true`,
      ])
      expect(meta.stdout).not.toContain('pando.kind')
    })
  })

  describe('validation', () => {
    it('refuses to adopt the main worktree', async () => {
      const result = await pandoAdopt(container, repoPath, [repoPath])
      expectJsonError(result, 'main worktree')
    })

    it('refuses a path that is not a linked worktree', async () => {
      await container.exec(['mkdir', '-p', '/tmp/not-a-wt'])
      const result = await pandoAdopt(container, repoPath, ['/tmp/not-a-wt'])
      expectJsonError(result, 'not a linked worktree')
    })
  })
})
