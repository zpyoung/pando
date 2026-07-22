import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRaw, mockReadFile, mockSimpleGit } = vi.hoisted(() => ({
  mockRaw: vi.fn(),
  mockReadFile: vi.fn(),
  mockSimpleGit: vi.fn(),
}))

vi.mock('simple-git', () => ({
  simpleGit: mockSimpleGit,
}))

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}))

import {
  assertGitVersion,
  ensureWorktreeConfigEnabled,
  enumerateAll,
  readMetadata,
  writeMetadata,
} from '../../src/utils/worktreeMetadata'

describe('worktreeMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSimpleGit.mockReturnValue({ raw: mockRaw })
  })

  describe('readMetadata', () => {
    it('parses metadata keys case-insensitively, including named ports', async () => {
      mockRaw.mockResolvedValue(
        `PANDO.KIND\nephemeral\0pando.CreatedAt\n2026-07-22T10:00:00.000Z\0PANDO.SOURCEBRANCH\nfeature/metadata branch\0pando.OWNER\nJane Doe\0pando.ttl\n12h\0PANDO.PORT.HTTP\n4310\0pando.port.debug\n9229\0pando.DB.NAME\npando_feature\0pando.unknown\nignored\0`
      )

      await expect(readMetadata('/repo/worktree')).resolves.toEqual({
        kind: 'ephemeral',
        createdAt: '2026-07-22T10:00:00.000Z',
        sourceBranch: 'feature/metadata branch',
        owner: 'Jane Doe',
        ttl: '12h',
        ports: { http: 4310, debug: 9229 },
        dbName: 'pando_feature',
      })
      expect(mockSimpleGit).toHaveBeenCalledWith('/repo/worktree')
      expect(mockRaw).toHaveBeenCalledWith([
        'config',
        '--worktree',
        '--get-regexp',
        '--null',
        '^pando\\.',
      ])
    })

    it('returns empty metadata when git config cannot be read', async () => {
      mockRaw.mockRejectedValue(new Error('no matching keys'))

      await expect(readMetadata('/not/a/repo')).resolves.toEqual({})
    })
  })

  describe('writeMetadata', () => {
    it('writes only fields present in the patch to worktree config', async () => {
      mockRaw.mockResolvedValue('')

      await writeMetadata('/repo/worktree', {
        kind: 'long-lived',
        createdAt: '2026-07-22T10:00:00.000Z',
        dbName: 'pando_long_lived',
        ports: { api: 3001, debug: 9229 },
      })

      expect(mockRaw.mock.calls).toEqual([
        [['config', '--worktree', 'pando.kind', 'long-lived']],
        [['config', '--worktree', 'pando.createdAt', '2026-07-22T10:00:00.000Z']],
        [['config', '--worktree', 'pando.db.name', 'pando_long_lived']],
        [['config', '--worktree', 'pando.port.api', '3001']],
        [['config', '--worktree', 'pando.port.debug', '9229']],
      ])
    })
  })

  describe('enumerateAll', () => {
    it('reads main and linked worktree config.worktree files directly', async () => {
      const mainPath = path.resolve('/repo/main')
      const linkedPath = path.resolve('/repo/linked worktree\nfeature')
      const commonDir = path.join(mainPath, '.git')
      const mainConfig = path.join(commonDir, 'config.worktree')
      const linkedConfig = path.join(commonDir, 'worktrees', 'feature', 'config.worktree')

      mockReadFile.mockImplementation((file: string) => {
        if (file === path.join(linkedPath, '.git')) {
          return Promise.resolve(`gitdir: ${path.join(commonDir, 'worktrees', 'feature')}\n`)
        }
        return Promise.reject(new Error(`unexpected file read: ${file}`))
      })
      mockRaw.mockImplementation((args: string[]) => {
        if (args[0] === 'worktree') {
          return Promise.resolve(
            `worktree ${mainPath}\0HEAD abc123\0branch refs/heads/main\0worktree ${linkedPath}\0HEAD def456\0branch refs/heads/feature\0`
          )
        }
        if (args[0] === 'rev-parse') return Promise.resolve('.git\n')
        if (args.includes(mainConfig)) {
          return Promise.resolve('pando.kind\nlong-lived\0pando.owner\nmain-owner\0')
        }
        if (args.includes(linkedConfig)) {
          return Promise.resolve('pando.kind\nephemeral\0pando.port.api\n4100\0')
        }
        return Promise.reject(new Error(`unexpected git call: ${args.join(' ')}`))
      })

      await expect(enumerateAll(mainPath)).resolves.toEqual([
        { worktreePath: mainPath, metadata: { kind: 'long-lived', owner: 'main-owner' } },
        {
          worktreePath: linkedPath,
          metadata: { kind: 'ephemeral', ports: { api: 4100 } },
        },
      ])
      expect(mockRaw).toHaveBeenCalledWith(['worktree', 'list', '--porcelain', '-z'])
      expect(mockRaw).toHaveBeenCalledWith([
        'config',
        '--file',
        mainConfig,
        '--get-regexp',
        '--null',
        '^pando\\.',
      ])
      expect(mockRaw).toHaveBeenCalledWith([
        'config',
        '--file',
        linkedConfig,
        '--get-regexp',
        '--null',
        '^pando\\.',
      ])
      expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['config', '--worktree']))
    })

    it('returns empty metadata when a worktree config file is missing', async () => {
      const mainPath = path.resolve('/repo/main')
      mockRaw.mockImplementation((args: string[]) => {
        if (args[0] === 'worktree') return Promise.resolve(`worktree ${mainPath}\0`)
        if (args[0] === 'rev-parse') return Promise.resolve('.git\n')
        return Promise.reject(new Error('config.worktree does not exist'))
      })

      await expect(enumerateAll(mainPath)).resolves.toEqual([
        { worktreePath: mainPath, metadata: {} },
      ])
    })
  })

  describe('ensureWorktreeConfigEnabled', () => {
    it('short-circuits when worktree config is already enabled', async () => {
      mockRaw.mockResolvedValue('true\n')

      await expect(ensureWorktreeConfigEnabled('/repo')).resolves.toEqual({
        enabled: true,
        migrated: [],
      })
      expect(mockRaw).toHaveBeenCalledTimes(1)
      expect(mockRaw).toHaveBeenCalledWith(['config', '--get', 'extensions.worktreeConfig'])
    })

    it('enables worktree config after copying shared core settings', async () => {
      mockRaw.mockImplementation((args: string[]) => {
        const key = args.at(-1)
        if (key === 'extensions.worktreeConfig' && args.includes('--get')) {
          return Promise.reject(new Error('not set'))
        }
        if (key === 'core.worktree') return Promise.resolve('/repo\n')
        if (key === 'core.bare') return Promise.resolve('false\n')
        if (key === 'core.sparseCheckout') return Promise.reject(new Error('not set'))
        return Promise.resolve('')
      })

      await expect(ensureWorktreeConfigEnabled('/repo')).resolves.toEqual({
        enabled: true,
        migrated: ['core.worktree', 'core.bare'],
        notice: 'Enabled extensions.worktreeConfig (migrated: core.worktree, core.bare)',
      })
      expect(mockRaw.mock.calls).toEqual([
        [['config', '--get', 'extensions.worktreeConfig']],
        [['config', '--local', '--get', 'core.worktree']],
        [['config', '--local', '--get', 'core.bare']],
        [['config', '--local', '--get', 'core.sparseCheckout']],
        [['config', 'extensions.worktreeConfig', 'true']],
        [['config', '--worktree', 'core.worktree', '/repo']],
        [['config', '--local', '--unset', 'core.worktree']],
        [['config', '--worktree', 'core.bare', 'false']],
        [['config', '--local', '--unset', 'core.bare']],
      ])
    })
  })

  describe('assertGitVersion', () => {
    it('throws when git is below the minimum version', async () => {
      mockRaw.mockResolvedValue('git version 2.37.5\n')

      await expect(assertGitVersion()).rejects.toThrow(
        'pando worktree metadata requires git >= 2.38 (found 2.37.5)'
      )
    })

    it.each(['git version 2.38.0\n', 'git version 2.53.0\n'])(
      'passes for a supported version: %s',
      async (output) => {
        mockRaw.mockResolvedValue(output)

        await expect(assertGitVersion()).resolves.toBeUndefined()
        expect(mockRaw).toHaveBeenCalledWith(['--version'])
      }
    )

    it('does not block when the version output cannot be parsed', async () => {
      mockRaw.mockResolvedValue('unknown git build')

      await expect(assertGitVersion()).resolves.toBeUndefined()
    })
  })
})
