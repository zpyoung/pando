import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnumerateAll, mockWriteMetadata } = vi.hoisted(() => ({
  mockEnumerateAll: vi.fn(),
  mockWriteMetadata: vi.fn(),
}))

vi.mock('../../src/utils/worktreeMetadata.js', () => ({
  enumerateAll: mockEnumerateAll,
  writeMetadata: mockWriteMetadata,
}))

import { allocate, deriveDbName } from '../../src/utils/portAllocator'

describe('portAllocator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnumerateAll.mockResolvedValue([])
    mockWriteMetadata.mockResolvedValue(undefined)
  })

  describe('allocate', () => {
    it('parses an inclusive range and allocates each port at most once', async () => {
      const isPortFree = vi.fn().mockResolvedValue(true)

      await expect(
        allocate('/repo/worktree', {
          range: '3100-3101',
          names: ['api', 'debug'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({ api: 3100, debug: 3101 })

      expect(isPortFree.mock.calls).toEqual([[3100], [3101]])
      expect(mockWriteMetadata).toHaveBeenCalledOnce()
      expect(mockWriteMetadata).toHaveBeenCalledWith('/repo/worktree', {
        ports: { api: 3100, debug: 3101 },
      })
    })

    it.each(['3100', 'abc-3199', '3100-3199-extra'])(
      'treats malformed range %s as empty',
      async (range) => {
        const isPortFree = vi.fn().mockResolvedValue(true)

        await expect(
          allocate('/repo/worktree', {
            range,
            names: ['api'],
            mainRepoPath: '/repo',
            isPortFree,
          })
        ).resolves.toEqual({})

        expect(isPortFree).not.toHaveBeenCalled()
        expect(mockWriteMetadata).toHaveBeenCalledWith('/repo/worktree', { ports: {} })
      }
    )

    it('treats an inverted range as empty', async () => {
      const isPortFree = vi.fn().mockResolvedValue(true)

      await expect(
        allocate('/repo/worktree', {
          range: '3199-3100',
          names: ['api'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({})

      expect(isPortFree).not.toHaveBeenCalled()
    })

    it('skips ports assigned in live worktree metadata', async () => {
      mockEnumerateAll.mockResolvedValue([
        { worktreePath: '/repo', metadata: { ports: { api: 3100 } } },
        { worktreePath: '/repo/other', metadata: { ports: { debug: 3101 } } },
      ])
      const isPortFree = vi.fn().mockResolvedValue(true)

      await expect(
        allocate('/repo/worktree', {
          range: '3100-3102',
          names: ['api'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({ api: 3102 })

      expect(mockEnumerateAll).toHaveBeenCalledWith('/repo')
      expect(isPortFree).toHaveBeenCalledOnce()
      expect(isPortFree).toHaveBeenCalledWith(3102)
    })

    it('reconciles when a peer claims the initially persisted port', async () => {
      const peer = {
        worktreePath: '/repo/peer',
        metadata: { ports: { api: 3100 } },
      }
      mockEnumerateAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([peer])
        .mockResolvedValue([peer])
      const isPortFree = vi.fn().mockResolvedValue(true)

      await expect(
        allocate('/repo/worktree', {
          range: '3100-3102',
          names: ['api'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({ api: 3101 })

      expect(isPortFree.mock.calls).toEqual([[3100], [3101]])
      expect(mockWriteMetadata.mock.calls).toEqual([
        ['/repo/worktree', { ports: { api: 3100 } }],
        ['/repo/worktree', { ports: { api: 3101 } }],
      ])
    })

    it('omits a colliding name when reconciliation cannot find a replacement', async () => {
      const peer = {
        worktreePath: '/repo/peer',
        metadata: { ports: { api: 3100 } },
      }
      mockEnumerateAll.mockResolvedValueOnce([]).mockResolvedValue([peer])
      const isPortFree = vi.fn().mockResolvedValue(true)

      await expect(
        allocate('/repo/worktree', {
          range: '3100-3100',
          names: ['api'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({})

      expect(mockWriteMetadata.mock.calls).toEqual([
        ['/repo/worktree', { ports: { api: 3100 } }],
        ['/repo/worktree', { ports: {} }],
      ])
    })

    it('picks the lowest port that passes the OS probe', async () => {
      const isPortFree = vi.fn(async (port: number) => port !== 3100)

      await expect(
        allocate('/repo/worktree', {
          range: '3100-3102',
          names: ['api'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({ api: 3101 })

      expect(isPortFree.mock.calls).toEqual([[3100], [3101]])
    })

    it('returns a partial result without throwing when the range is exhausted', async () => {
      const isPortFree = vi.fn().mockResolvedValue(true)

      await expect(
        allocate('/repo/worktree', {
          range: '3100-3100',
          names: ['api', 'debug'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({ api: 3100 })

      expect(mockWriteMetadata).toHaveBeenCalledWith('/repo/worktree', {
        ports: { api: 3100 },
      })
    })

    it('treats probe errors as taken ports instead of throwing', async () => {
      const isPortFree = vi.fn().mockRejectedValue(new Error('probe failed'))

      await expect(
        allocate('/repo/worktree', {
          range: '3100-3101',
          names: ['api'],
          mainRepoPath: '/repo',
          isPortFree,
        })
      ).resolves.toEqual({})
    })

    it('allocates only names accepted by git config and returns a plain object', async () => {
      const isPortFree = vi.fn().mockResolvedValue(true)

      const result = await allocate('/repo/worktree', {
        range: '3100-3101',
        names: ['__proto__', '9foo', 'api_server', '', 'foo bar', 'web', 'foo-bar'],
        mainRepoPath: '/repo',
        isPortFree,
      })

      expect(result).toEqual({ web: 3100, 'foo-bar': 3101 })
      for (const name of ['__proto__', '9foo', 'api_server', '', 'foo bar']) {
        expect(Object.hasOwn(result, name)).toBe(false)
      }
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
      expect(isPortFree.mock.calls).toEqual([[3100], [3101]])
      expect(mockWriteMetadata).toHaveBeenCalledWith('/repo/worktree', {
        ports: { web: 3100, 'foo-bar': 3101 },
      })
    })
  })

  describe('deriveDbName', () => {
    it('sanitizes, lowercases, and collapses branch separators', () => {
      expect(deriveDbName('base', 'feature///Foo___Bar---baz')).toBe('base_feature_foo_bar_baz')
    })

    it.each([
      ['日本語', 'base_c12140a0'],
      ['+++', 'base_86c3ea5a'],
      ['___', 'base_bf295750'],
    ])('uses a stable hash when %s has no ASCII alphanumeric suffix', (branch, expected) => {
      expect(deriveDbName('base', branch)).toBe(expected)
    })
  })
})
