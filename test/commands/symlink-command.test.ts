import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { promisify } from 'node:util'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'fs-extra'
import SymlinkWorktreeFile from '../../src/commands/symlink'

const execFileAsync = promisify(execFile)

interface GitWorktreeFixture {
  root: string
  main: string
  feature: string
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

async function createWorktreeFixture(): Promise<GitWorktreeFixture> {
  // On macOS os.tmpdir() returns a /var path that is a symlink to /private/var.
  // git resolves worktree paths to their realpath, so resolve the root up front to
  // keep expected paths in sync with what the command reports.
  const root = await fs.realpath(await mkdtemp(path.join(os.tmpdir(), 'pando-symlink-command-')))
  const main = path.join(root, 'repo')
  const feature = path.join(root, 'repo-feature')

  await fs.ensureDir(main)
  await git(main, ['init', '--initial-branch=main'])
  await git(main, ['config', 'user.email', 'pando-test@example.com'])
  await git(main, ['config', 'user.name', 'Pando Test'])
  await fs.writeFile(path.join(main, 'README.md'), 'main worktree\n')
  await git(main, ['add', 'README.md'])
  await git(main, ['commit', '-m', 'initial commit'])
  await git(main, ['worktree', 'add', '-b', 'feature/symlink-command', feature])

  return { root, main, feature }
}

function parseLoggedJson(logSpy: ReturnType<typeof vi.spyOn>): unknown {
  const output = logSpy.mock.calls
    .map((call) => call[0])
    .filter((value): value is string => typeof value === 'string' && value.trim().startsWith('{'))
    .join('\n')

  return JSON.parse(output)
}

describe('symlink command execution', () => {
  const originalCwd = process.cwd()
  let fixtures: GitWorktreeFixture[] = []

  beforeEach(() => {
    fixtures = []
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()

    for (const fixture of fixtures) {
      await fs.remove(fixture.root)
    }
  })

  it('moves a worktree file to the main worktree and replaces it with a relative symlink in json mode', async () => {
    const fixture = await createWorktreeFixture()
    fixtures.push(fixture)
    const sourceFile = path.join(fixture.feature, 'nested', 'settings.json')
    const destFile = path.join(fixture.main, 'nested', 'settings.json')
    await fs.ensureDir(path.dirname(sourceFile))
    await fs.writeJson(sourceFile, { source: 'feature' })
    process.chdir(fixture.feature)

    const logSpy = vi.spyOn(SymlinkWorktreeFile.prototype, 'log').mockImplementation(() => {})

    await SymlinkWorktreeFile.run(['nested/settings.json', '--json'])

    const payload = parseLoggedJson(logSpy)
    expect(payload).toEqual({
      success: true,
      source: sourceFile,
      destination: destFile,
      link: sourceFile,
    })
    await expect(fs.readJson(destFile)).resolves.toEqual({ source: 'feature' })
    const linkStats = await fs.lstat(sourceFile)
    expect(linkStats.isSymbolicLink()).toBe(true)
    await expect(fs.readlink(sourceFile)).resolves.toBe(
      path.relative(path.dirname(sourceFile), destFile)
    )
  })

  it('reports a deterministic json validation error and leaves files untouched when destination exists without force', async () => {
    const fixture = await createWorktreeFixture()
    fixtures.push(fixture)
    const sourceFile = path.join(fixture.feature, 'conflict.txt')
    const destFile = path.join(fixture.main, 'conflict.txt')
    await fs.writeFile(sourceFile, 'feature copy\n')
    await fs.writeFile(destFile, 'main copy\n')
    process.chdir(fixture.feature)

    const logSpy = vi.spyOn(SymlinkWorktreeFile.prototype, 'log').mockImplementation(() => {})

    await expect(SymlinkWorktreeFile.run(['conflict.txt', '--json'])).rejects.toMatchObject({
      oclif: { exit: 1 },
    })

    const payload = parseLoggedJson(logSpy)
    expect(payload).toEqual({
      success: false,
      error: `Destination file already exists: ${destFile}\nUse --force to overwrite.`,
    })
    await expect(fs.readFile(sourceFile, 'utf8')).resolves.toBe('feature copy\n')
    await expect(fs.readFile(destFile, 'utf8')).resolves.toBe('main copy\n')
  })

  it('prints structured dry-run json without copying, removing, or symlinking the source file', async () => {
    const fixture = await createWorktreeFixture()
    fixtures.push(fixture)
    const sourceFile = path.join(fixture.feature, 'dry-run.txt')
    const destFile = path.join(fixture.main, 'dry-run.txt')
    await fs.writeFile(sourceFile, 'dry run only\n')
    process.chdir(fixture.feature)

    const logSpy = vi.spyOn(SymlinkWorktreeFile.prototype, 'log').mockImplementation(() => {})

    await SymlinkWorktreeFile.run(['dry-run.txt', '--dry-run', '--json'])

    const payload = parseLoggedJson(logSpy)
    expect(payload).toEqual({
      success: true,
      dryRun: true,
      source: sourceFile,
      destination: destFile,
      link: sourceFile,
    })
    await expect(fs.readFile(sourceFile, 'utf8')).resolves.toBe('dry run only\n')
    await expect(fs.pathExists(destFile)).resolves.toBe(false)
    const sourceStats = await fs.lstat(sourceFile)
    expect(sourceStats.isSymbolicLink()).toBe(false)
  })

  it('overwrites the destination with --force, replacing the source with a symlink', async () => {
    const fixture = await createWorktreeFixture()
    fixtures.push(fixture)
    const sourceFile = path.join(fixture.feature, 'force.txt')
    const destFile = path.join(fixture.main, 'force.txt')
    await fs.writeFile(sourceFile, 'feature copy\n')
    await fs.writeFile(destFile, 'stale main copy\n')
    process.chdir(fixture.feature)

    const logSpy = vi.spyOn(SymlinkWorktreeFile.prototype, 'log').mockImplementation(() => {})

    await SymlinkWorktreeFile.run(['force.txt', '--force', '--json'])

    const payload = parseLoggedJson(logSpy)
    expect(payload).toEqual({
      success: true,
      source: sourceFile,
      destination: destFile,
      link: sourceFile,
    })
    // The destination is overwritten with the feature copy...
    await expect(fs.readFile(destFile, 'utf8')).resolves.toBe('feature copy\n')
    // ...and the source is now a relative symlink pointing at it.
    const linkStats = await fs.lstat(sourceFile)
    expect(linkStats.isSymbolicLink()).toBe(true)
    await expect(fs.readlink(sourceFile)).resolves.toBe(
      path.relative(path.dirname(sourceFile), destFile)
    )
  })

  it('emits human-readable output (not JSON) and performs the move when --json is omitted', async () => {
    const fixture = await createWorktreeFixture()
    fixtures.push(fixture)
    const sourceFile = path.join(fixture.feature, 'human.txt')
    const destFile = path.join(fixture.main, 'human.txt')
    await fs.writeFile(sourceFile, 'human readable\n')
    process.chdir(fixture.feature)

    const logSpy = vi.spyOn(SymlinkWorktreeFile.prototype, 'log').mockImplementation(() => {})

    await SymlinkWorktreeFile.run(['human.txt'])

    const lines = logSpy.mock.calls
      .map((call) => call[0])
      .filter((value): value is string => typeof value === 'string')
    const combined = lines.join('\n')

    // Human output, not a JSON blob.
    expect(combined).not.toMatch(/^\s*\{/)
    expect(combined).toContain('Moved human.txt to main worktree')
    expect(combined).toContain(`Source: ${sourceFile}`)
    expect(combined).toContain(`Dest:   ${destFile}`)
    expect(combined).toContain('Created symlink')

    // The actual move + symlink still happened.
    await expect(fs.readFile(destFile, 'utf8')).resolves.toBe('human readable\n')
    const linkStats = await fs.lstat(sourceFile)
    expect(linkStats.isSymbolicLink()).toBe(true)
  })

  it('reports a json validation error and exits non-zero when the source file is missing', async () => {
    const fixture = await createWorktreeFixture()
    fixtures.push(fixture)
    const missing = path.join(fixture.feature, 'does-not-exist.txt')
    process.chdir(fixture.feature)

    const logSpy = vi.spyOn(SymlinkWorktreeFile.prototype, 'log').mockImplementation(() => {})

    await expect(SymlinkWorktreeFile.run(['does-not-exist.txt', '--json'])).rejects.toMatchObject({
      oclif: { exit: 1 },
    })

    const payload = parseLoggedJson(logSpy) as { success: boolean; error: string }
    expect(payload.success).toBe(false)
    expect(payload.error).toBe(`Source file does not exist: ${missing}`)
    // Nothing was created in the main worktree.
    await expect(fs.pathExists(path.join(fixture.main, 'does-not-exist.txt'))).resolves.toBe(false)
  })
})
