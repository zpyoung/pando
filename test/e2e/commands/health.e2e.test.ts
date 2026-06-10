import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../helpers/container.js'
import { setupGitRepo } from '../helpers/git-repo.js'
import { pandoAdd, pandoHealth, pandoHealthHuman } from '../helpers/cli-runner.js'
import { expectSuccess } from '../helpers/assertions.js'

interface HealthWorktree {
  path: string
  branch: string | null
  status: string
  message?: string
  details?: { uncommittedFiles?: number }
}

interface HealthSummary {
  clean: number
  detached: number
  uncommitted: number
  behind: number
  gone: number
  errors: number
}

/**
 * E2E coverage for `pando health`.
 *
 * Drives the real status-detection logic against actual git worktrees:
 * a freshly-created worktree is clean, a worktree with an unstaged edit is
 * uncommitted, and a detached-HEAD worktree is reported as detached (not clean).
 */
describe('pando health (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
    repoPath = await setupGitRepo(container, {
      name: 'health-test-repo',
      files: [{ path: 'README.md', content: '# Health Test' }],
    })
  })

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  it('exposes the full summary shape including the detached field', async () => {
    const result = await pandoHealth(container, repoPath)

    expectSuccess(result)
    const summary = result.json?.summary as HealthSummary
    expect(summary).toBeDefined()
    // The summary must carry every status bucket, including `detached`
    // (the field added during the health bug-fix work).
    expect(summary).toHaveProperty('clean')
    expect(summary).toHaveProperty('detached')
    expect(summary).toHaveProperty('uncommitted')
    expect(summary).toHaveProperty('behind')
    expect(summary).toHaveProperty('gone')
    expect(summary).toHaveProperty('errors')
  })

  it('reports a freshly-created worktree as clean', async () => {
    const addResult = await pandoAdd(container, repoPath, [
      '--branch',
      'health-clean',
      '--path',
      '../worktrees/health-clean',
      '--skip-rsync',
    ])
    expectSuccess(addResult)
    const worktreePath = (addResult.json?.worktree as { path: string }).path

    const result = await pandoHealth(container, repoPath)

    expectSuccess(result)
    const worktrees = result.json?.worktrees as HealthWorktree[]
    const wt = worktrees.find((w) => w.path === worktreePath)
    expect(wt).toBeDefined()
    expect(wt?.status).toBe('clean')
  })

  it('reports a worktree with an uncommitted edit as uncommitted', async () => {
    const addResult = await pandoAdd(container, repoPath, [
      '--branch',
      'health-dirty',
      '--path',
      '../worktrees/health-dirty',
      '--skip-rsync',
    ])
    expectSuccess(addResult)
    const worktreePath = (addResult.json?.worktree as { path: string }).path

    // Modify a tracked file so the worktree has uncommitted changes.
    await container.exec(['sh', '-c', `cd ${worktreePath} && echo "local edit" >> README.md`])

    const result = await pandoHealth(container, repoPath)

    expectSuccess(result)
    const summary = result.json?.summary as HealthSummary
    expect(summary.uncommitted).toBeGreaterThanOrEqual(1)

    const worktrees = result.json?.worktrees as HealthWorktree[]
    const wt = worktrees.find((w) => w.path === worktreePath)
    expect(wt?.status).toBe('uncommitted')
    expect(wt?.message).toMatch(/file/i)
    expect(wt?.details?.uncommittedFiles).toBeGreaterThanOrEqual(1)
  })

  it('reports a detached-HEAD worktree as detached, not clean', async () => {
    const addResult = await pandoAdd(container, repoPath, [
      '--path',
      '../worktrees/health-detached',
      '--commit',
      'HEAD',
      '--skip-rsync',
    ])
    expectSuccess(addResult)
    const worktreePath = (addResult.json?.worktree as { path: string }).path

    const result = await pandoHealth(container, repoPath)

    expectSuccess(result)
    const summary = result.json?.summary as HealthSummary
    expect(summary.detached).toBeGreaterThanOrEqual(1)

    const worktrees = result.json?.worktrees as HealthWorktree[]
    const wt = worktrees.find((w) => w.path === worktreePath)
    expect(wt).toBeDefined()
    expect(wt?.branch).toBeNull()
    expect(wt?.status).toBe('detached')
  })

  it('emits human-readable output when --json is omitted', async () => {
    const result = await pandoHealthHuman(container, repoPath)

    expectSuccess(result)
    expect(result.stdout).not.toMatch(/^\s*\{/)
    expect(result.stdout).toContain('Worktree Health Report')
  })
})
