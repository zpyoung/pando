import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoAdd, pandoClean, pandoCleanHuman } from '../helpers/cli-runner.js'
import { expectSuccess } from '../helpers/assertions.js'

/**
 * E2E coverage for `pando clean`.
 *
 * Exercises the real prune path: a worktree whose directory has been deleted
 * out from under git becomes "prunable", and `pando clean` should detect and
 * remove it (verified against `git worktree list`).
 */
describe('pando clean (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
    repoPath = await setupGitRepo(container, {
      name: 'clean-test-repo',
      files: [{ path: 'README.md', content: '# Clean Test' }],
    })
  })

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  /** List worktree paths via raw `git worktree list --porcelain`. */
  async function gitWorktreePaths(): Promise<string[]> {
    const result = await container.exec([
      'sh',
      '-c',
      `cd ${repoPath} && git worktree list --porcelain`,
    ])
    return result.stdout
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length).trim())
  }

  it('reports nothing_to_clean when all worktrees are healthy', async () => {
    const result = await pandoClean(container, repoPath)

    expectSuccess(result)
    expect(result.json?.status).toBe('nothing_to_clean')
    expect(result.json?.removed).toEqual([])
  })

  it('prunes a worktree whose directory was deleted manually', async () => {
    const worktreeRel = '../worktrees/clean-prunable'

    // Create a real worktree...
    const addResult = await pandoAdd(container, repoPath, [
      '--branch',
      'clean-prunable',
      '--path',
      worktreeRel,
      '--skip-rsync',
    ])
    expectSuccess(addResult)
    const worktreePath = (addResult.json?.worktree as { path: string }).path

    // ...then delete its directory out from under git, making it prunable.
    await container.exec(['rm', '-rf', worktreePath])

    // git still lists the (now-missing) worktree.
    expect(await gitWorktreePaths()).toContain(worktreePath)

    // Clean it. In --json mode all stale worktrees are auto-selected; --force
    // ensures removal even though the branch is unmerged.
    const cleanResult = await pandoClean(container, repoPath, ['--force'])

    expectSuccess(cleanResult)
    expect(cleanResult.json?.status).toBe('success')
    const removed = cleanResult.json?.removed as Array<{ path: string; staleReason: string }>
    const removedEntry = removed.find((r) => r.path === worktreePath)
    expect(removedEntry).toBeDefined()
    expect(removedEntry?.staleReason).toBe('prunable')

    // git no longer lists it.
    expect(await gitWorktreePaths()).not.toContain(worktreePath)
  })

  it('lists prunable worktrees with --dry-run without removing them', async () => {
    const worktreeRel = '../worktrees/clean-dry-run'

    const addResult = await pandoAdd(container, repoPath, [
      '--branch',
      'clean-dry-run',
      '--path',
      worktreeRel,
      '--skip-rsync',
    ])
    expectSuccess(addResult)
    const worktreePath = (addResult.json?.worktree as { path: string }).path

    await container.exec(['rm', '-rf', worktreePath])
    expect(await gitWorktreePaths()).toContain(worktreePath)

    // Dry-run: report what WOULD be cleaned, change nothing.
    const dryResult = await pandoClean(container, repoPath, ['--dry-run'])

    expectSuccess(dryResult)
    expect(dryResult.json?.removed).toEqual([])
    const skipped = dryResult.json?.skipped as Array<{ path: string; reason: string }>
    expect(skipped.some((s) => s.path === worktreePath && s.reason === 'dry-run')).toBe(true)
    const stale = dryResult.json?.staleWorktrees as Array<{ path: string }>
    expect(stale.some((s) => s.path === worktreePath)).toBe(true)

    // Still listed by git (dry-run did not prune).
    expect(await gitWorktreePaths()).toContain(worktreePath)

    // Cleanup so it doesn't leak into other ordering-sensitive assertions.
    // Assert the cleanup actually pruned the worktree so a silent failure here
    // can't masquerade as the next test's "no stale worktrees" expectation.
    const cleanup = await pandoClean(container, repoPath, ['--force'])
    expectSuccess(cleanup)
    expect(await gitWorktreePaths()).not.toContain(worktreePath)
  })

  it('emits human-readable output when --json is omitted', async () => {
    // Self-contained: don't rely on prior tests having cleaned up. Run a
    // defensive force-clean first so this passes regardless of ordering or
    // test retries (any leftover stale worktree is pruned before we assert).
    await pandoClean(container, repoPath, ['--force'])

    const result = await pandoCleanHuman(container, repoPath)

    expectSuccess(result)
    // No stale worktrees remain after the prune tests, so the friendly
    // "no stale worktrees" message should appear (not a JSON blob).
    expect(result.stdout).not.toMatch(/^\s*\{/)
    expect(result.stdout.toLowerCase()).toContain('no stale worktrees')
  })
})
