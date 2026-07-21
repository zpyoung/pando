import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { GitHelper } from '../../src/utils/git'
import { createWorktreeSetupOrchestrator } from '../../src/utils/worktreeSetup'
import { DEFAULT_CONFIG, type PandoConfig } from '../../src/config/schema'

const execFileAsync = promisify(execFile)

/**
 * Integration regression tests for the "pando add leaves worktree dirty" bug
 * report. Real git repositories and real rsync - no mocks - covering:
 *
 * 1. skip-worktree filtering (mixed ignored + tracked symlink patterns)
 * 2. rsync tracked-file protection across branches
 * 3. tracked-symlink guard (symlink.allowTracked)
 * 4. clean-tree invariant end-to-end
 * 5. source-worktree integrity (rsync/symlink ordering must never write into
 *    the shared source tree)
 */

describe('worktree setup integration (real git + rsync)', () => {
  let tmpRoot: string
  let repoDir: string
  let worktreeDir: string
  let gitHelper: GitHelper

  const git = (args: string[], cwd: string = repoDir) =>
    execFileAsync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })

  const gitStatus = async (cwd: string): Promise<string> => {
    const { stdout } = await git(['status', '--porcelain'], cwd)
    return stdout.trim()
  }

  const write = async (relPath: string, content: string, base: string = repoDir) => {
    const fullPath = path.join(base, relPath)
    await fs.ensureDir(path.dirname(fullPath))
    await fs.writeFile(fullPath, content)
  }

  /** Recursive snapshot of a tree (path -> content or symlink target), excluding .git */
  const snapshotTree = async (dir: string): Promise<Map<string, string>> => {
    const snapshot = new Map<string, string>()
    const walk = async (current: string): Promise<void> => {
      for (const entry of await fs.readdir(current)) {
        if (entry === '.git') continue
        const fullPath = path.join(current, entry)
        const relPath = path.relative(dir, fullPath)
        const stats = await fs.lstat(fullPath)
        if (stats.isSymbolicLink()) {
          snapshot.set(relPath, `symlink:${await fs.readlink(fullPath)}`)
        } else if (stats.isDirectory()) {
          await walk(fullPath)
        } else {
          snapshot.set(relPath, (await fs.readFile(fullPath)).toString())
        }
      }
    }
    await walk(dir)
    return snapshot
  }

  const makeConfig = (overrides: {
    rsync?: Partial<PandoConfig['rsync']>
    symlink?: Partial<PandoConfig['symlink']>
  }): PandoConfig => ({
    ...DEFAULT_CONFIG,
    rsync: { ...DEFAULT_CONFIG.rsync, ...overrides.rsync },
    symlink: { ...DEFAULT_CONFIG.symlink, ...overrides.symlink },
  })

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-integration-'))
    repoDir = path.join(tmpRoot, 'repo')
    worktreeDir = path.join(tmpRoot, 'worktrees', 'feature')
    await fs.ensureDir(repoDir)

    await git(['init', '-q', '-b', 'main'])
    await git(['config', 'user.email', 'test@pando.dev'])
    await git(['config', 'user.name', 'Pando Test'])

    // Tracked content on main
    await write('src/app.py', 'print("main")\n')
    await write('CLAUDE.md', '# claude instructions\n')
    await write('.claude/settings.json', '{"shared": true}\n')
    await write('.gitignore', '.env\n.venv/\n')
    await git(['add', '-A'])
    await git(['commit', '-qm', 'initial commit'])

    // A feature branch whose tracked tree DIFFERS from main
    await git(['switch', '-qc', 'feature'])
    await write('src/app.py', 'print("feature")\n')
    await write('feature-only.py', 'print("only on feature")\n')
    await git(['add', '-A'])
    await git(['commit', '-qm', 'feature work'])
    await git(['switch', '-q', 'main'])

    // Untracked state in the source worktree:
    await write('.env', 'SECRET=1\n') // gitignored, symlink pattern
    await write('.venv/lib/pkg.py', 'venv artifact\n') // gitignored artifact
    await write('wip-note.md', 'work in progress\n') // untracked, NOT ignored

    // The worktree under test, on the existing feature branch (different commit)
    await fs.ensureDir(path.dirname(worktreeDir))
    await git(['worktree', 'add', '-q', worktreeDir, 'feature'])

    gitHelper = new GitHelper(repoDir)
  })

  afterEach(async () => {
    await fs.remove(tmpRoot)
  })

  it('leaves a clean tree for an existing branch with the default config', async () => {
    // Mirrors the reported repro: existing branch, mixed ignored+tracked
    // symlink patterns, rsync enabled
    const config = makeConfig({
      symlink: { patterns: ['.env', 'CLAUDE.md', '.claude/'] },
    })

    const result = await createWorktreeSetupOrchestrator(gitHelper, config).setupNewWorktree(
      worktreeDir
    )

    expect(result.success).toBe(true)

    // Tracked content comes from the branch's own checkout, never from rsync
    expect(await fs.readFile(path.join(worktreeDir, 'src/app.py'), 'utf8')).toBe(
      'print("feature")\n'
    )
    expect(await fs.pathExists(path.join(worktreeDir, 'feature-only.py'))).toBe(true)

    // Ignored artifacts arrive; non-ignored untracked WIP does not
    expect(await fs.readFile(path.join(worktreeDir, '.venv/lib/pkg.py'), 'utf8')).toBe(
      'venv artifact\n'
    )
    expect(await fs.pathExists(path.join(worktreeDir, 'wip-note.md'))).toBe(false)

    // All patterns are symlinked, tracked ones included (allowTracked default)
    expect((await fs.lstat(path.join(worktreeDir, '.env'))).isSymbolicLink()).toBe(true)
    expect((await fs.lstat(path.join(worktreeDir, 'CLAUDE.md'))).isSymbolicLink()).toBe(true)
    expect((await fs.lstat(path.join(worktreeDir, '.claude'))).isSymbolicLink()).toBe(true)

    // The mixed ignored+tracked pattern list must not abort the skip-worktree
    // batch: CLAUDE.md and .claude/settings.json get marked, .env is filtered
    expect(result.skipWorktreeResult).toBeDefined()
    expect(result.skipWorktreeResult?.success).toBe(true)
    expect(result.skipWorktreeResult?.filesMarked).toBe(2)
    expect(result.warnings.some((w) => w.includes('Could not mark'))).toBe(false)

    // Status shows nothing except the intentional .claude dir symlink, which
    // the clean-tree check tolerates
    expect(result.cleanTree).toBe(true)
    expect(await gitStatus(worktreeDir)).toBe('?? .claude')
  })

  it('skips tracked symlink patterns with a warning when allowTracked=false', async () => {
    const config = makeConfig({
      symlink: { patterns: ['.env', 'CLAUDE.md', '.claude/'], allowTracked: false },
    })

    const result = await createWorktreeSetupOrchestrator(gitHelper, config).setupNewWorktree(
      worktreeDir
    )

    expect(result.success).toBe(true)
    expect(result.cleanTree).toBe(true)
    expect(await gitStatus(worktreeDir)).toBe('')

    // Ignored pattern is symlinked; tracked patterns stay as checked-out files
    expect((await fs.lstat(path.join(worktreeDir, '.env'))).isSymbolicLink()).toBe(true)
    expect((await fs.lstat(path.join(worktreeDir, 'CLAUDE.md'))).isFile()).toBe(true)
    expect((await fs.lstat(path.join(worktreeDir, '.claude'))).isDirectory()).toBe(true)
    expect(
      result.warnings.some(
        (w) =>
          w.includes('Skipped symlinking git-tracked path(s)') &&
          w.includes('CLAUDE.md') &&
          w.includes('.claude')
      )
    ).toBe(true)
  })

  it('never modifies the source worktree (rsync + beforeRsync symlinks)', async () => {
    const config = makeConfig({
      symlink: { patterns: ['.env', 'CLAUDE.md', '.claude/'], allowTracked: true },
    })

    const sourceBefore = await snapshotTree(repoDir)
    const sourceStatusBefore = await gitStatus(repoDir)

    await createWorktreeSetupOrchestrator(gitHelper, config).setupNewWorktree(worktreeDir)

    const sourceAfter = await snapshotTree(repoDir)
    expect(Object.fromEntries(sourceAfter)).toEqual(Object.fromEntries(sourceBefore))
    expect(await gitStatus(repoDir)).toBe(sourceStatusBefore)
  })

  it('full mirror mode still refuses to rsync across different commits', async () => {
    const config = makeConfig({
      rsync: { onlyUntracked: false },
      symlink: { patterns: ['.env'] },
    })

    const result = await createWorktreeSetupOrchestrator(gitHelper, config).setupNewWorktree(
      worktreeDir
    )

    expect(result.success).toBe(true)
    expect(result.rsyncResult).toBeUndefined()
    expect(result.warnings.some((w) => w.includes('Skipped rsync because source worktree'))).toBe(
      true
    )
    // Tracked files stay pristine because nothing was copied
    expect(result.cleanTree).toBe(true)
    expect(await fs.readFile(path.join(worktreeDir, 'src/app.py'), 'utf8')).toBe(
      'print("feature")\n'
    )
  })

  it('a tracked file that differs between branches is never clobbered by rsync', async () => {
    // Regression for the reported defect: rsync copied the source branch's
    // tracked tree over the target checkout (src/app.py differs between
    // main and feature)
    const config = makeConfig({ symlink: { patterns: [] } })

    const result = await createWorktreeSetupOrchestrator(gitHelper, config).setupNewWorktree(
      worktreeDir
    )

    expect(result.success).toBe(true)
    expect(await fs.readFile(path.join(worktreeDir, 'src/app.py'), 'utf8')).toBe(
      'print("feature")\n'
    )
    expect(await gitStatus(worktreeDir)).toBe('')
  })
})
