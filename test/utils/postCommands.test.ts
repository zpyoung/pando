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
    // On macOS os.tmpdir() returns a /var path that is a symlink to /private/var,
    // so `pwd` (and any realpath comparison) reports the resolved path. Resolve
    // immediately so tempDir is consistent everywhere it's used (cwd + assertions).
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pando-post-command-')))

    const results = await runPostCommandScripts(
      [
        {
          name: 'write-marker',
          command:
            'pwd && printf "$PANDO_BRANCH" > branch.txt && printf "$PANDO_KIND:$PANDO_TTL" > lifecycle.txt',
        },
      ],
      {
        commandName: 'add',
        cwd: tempDir,
        worktreePath: tempDir,
        branch: 'feature/post-command',
        commit: 'abc123',
        kind: 'ephemeral',
        ttl: '4h',
      }
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      name: 'write-marker',
      command:
        'pwd && printf "$PANDO_BRANCH" > branch.txt && printf "$PANDO_KIND:$PANDO_TTL" > lifecycle.txt',
      cwd: tempDir,
      exitCode: 0,
      signal: null,
      success: true,
    })
    expect(results[0]?.stdout.trim()).toBe(tempDir)
    await expect(fs.readFile(path.join(tempDir, 'branch.txt'), 'utf8')).resolves.toBe(
      'feature/post-command'
    )
    await expect(fs.readFile(path.join(tempDir, 'lifecycle.txt'), 'utf8')).resolves.toBe(
      'ephemeral:4h'
    )
  })

  it('injects allocated ports with env-safe names and the database name', async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pando-post-command-')))

    await runPostCommandScripts(
      [
        {
          command: 'printf "$PANDO_PORT_WEB_API:$PANDO_PORT_WORKER:$PANDO_DB_NAME" > resources.txt',
        },
      ],
      {
        commandName: 'add',
        cwd: tempDir,
        worktreePath: tempDir,
        branch: 'feature/ports',
        commit: 'abc123',
        ports: { 'web-api': 4310, worker: 4311 },
        dbName: 'dev_feature_ports',
      }
    )

    await expect(fs.readFile(path.join(tempDir, 'resources.txt'), 'utf8')).resolves.toBe(
      '4310:4311:dev_feature_ports'
    )
  })

  it('does not add port or database variables without allocation context', async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pando-post-command-')))
    const previousPort = process.env.PANDO_PORT_WEB_API
    const previousDbName = process.env.PANDO_DB_NAME
    delete process.env.PANDO_PORT_WEB_API
    delete process.env.PANDO_DB_NAME

    try {
      await runPostCommandScripts(
        [
          {
            command: 'printf "${PANDO_PORT_WEB_API-unset}:${PANDO_DB_NAME-unset}" > resources.txt',
          },
        ],
        {
          commandName: 'add',
          cwd: tempDir,
          worktreePath: tempDir,
          branch: 'feature/no-ports',
          commit: 'abc123',
        }
      )
    } finally {
      if (previousPort === undefined) delete process.env.PANDO_PORT_WEB_API
      else process.env.PANDO_PORT_WEB_API = previousPort
      if (previousDbName === undefined) delete process.env.PANDO_DB_NAME
      else process.env.PANDO_DB_NAME = previousDbName
    }

    await expect(fs.readFile(path.join(tempDir, 'resources.txt'), 'utf8')).resolves.toBe(
      'unset:unset'
    )
  })

  it('throws with captured result when a script exits non-zero', async () => {
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pando-post-command-')))

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
