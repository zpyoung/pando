import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import type { PandoConfig } from '../../src/config/schema'
import { normalizePostCommandScripts, runPostCommandScripts } from '../../src/utils/postCommands'

const makeConfig = (postCommands: PandoConfig['postCommands']): PandoConfig => ({
  rsync: {
    enabled: true,
    flags: ['--archive', '--exclude', '.git'],
    exclude: [],
  },
  symlink: {
    patterns: [],
    relative: true,
    beforeRsync: true,
  },
  worktree: {
    rebaseOnAdd: true,
    deleteBranchOnRemove: 'local',
    useProjectSubfolder: false,
    targetBranch: 'main',
  },
  clean: {
    fetch: false,
  },
  postCommands,
})

describe('postCommands', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir) {
      await fs.remove(tempDir)
      tempDir = undefined
    }
  })

  it('normalizes configured scripts for a command', () => {
    const config = makeConfig({
      add: ['pnpm install', { name: 'setup', command: 'npm run setup' }],
    })

    expect(normalizePostCommandScripts(config, 'add')).toEqual([
      { command: 'pnpm install' },
      { name: 'setup', command: 'npm run setup' },
    ])
  })

  it('runs successful scripts in the worktree directory and captures output', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-post-command-'))

    const results = await runPostCommandScripts(
      [{ name: 'write-marker', command: 'pwd && printf "$PANDO_BRANCH" > branch.txt' }],
      {
        commandName: 'add',
        cwd: tempDir,
        worktreePath: tempDir,
        branch: 'feature/post-command',
        commit: 'abc123',
      }
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      name: 'write-marker',
      command: 'pwd && printf "$PANDO_BRANCH" > branch.txt',
      cwd: tempDir,
      exitCode: 0,
      signal: null,
      success: true,
    })
    expect(results[0]?.stdout.trim()).toBe(tempDir)
    await expect(fs.readFile(path.join(tempDir, 'branch.txt'), 'utf8')).resolves.toBe(
      'feature/post-command'
    )
  })

  it('throws with captured result when a script exits non-zero', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-post-command-'))

    await expect(
      runPostCommandScripts([{ command: 'printf fail-message >&2; exit 7' }], {
        commandName: 'add',
        cwd: tempDir,
        worktreePath: tempDir,
        branch: null,
        commit: 'abc123',
      })
    ).rejects.toMatchObject({
      name: 'PostCommandError',
      result: {
        command: 'printf fail-message >&2; exit 7',
        cwd: tempDir,
        exitCode: 7,
        stderr: 'fail-message',
        success: false,
      },
    })
  })
})
