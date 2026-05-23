import { describe, expect, it } from 'vitest'
import { buildAddCommandDetails } from '../../src/utils/commandDetails'
import { OperationType, type Operation } from '../../src/utils/fileOps'

describe('commandDetails', () => {
  it('builds stable add details when requested', () => {
    const operations: Operation[] = [
      {
        type: OperationType.CREATE_SYMLINK,
        path: '/worktrees/feature/package.json',
        metadata: {
          source: '/repo/package.json',
          linkPath: '../repo/package.json',
        },
        timestamp: new Date('2026-01-01T00:00:00Z'),
      },
      {
        type: OperationType.CREATE_SYMLINK,
        path: '/worktrees/feature/pnpm-lock.yaml',
        metadata: {
          source: '/repo/pnpm-lock.yaml',
          linkPath: '../repo/pnpm-lock.yaml',
        },
        timestamp: new Date('2026-01-01T00:00:01Z'),
      },
    ]

    const details = buildAddCommandDetails({
      rsyncResult: {
        success: true,
        filesTransferred: 12,
        bytesSent: 345,
        totalSize: 6789,
        duration: 234,
      },
      symlinkResult: {
        success: true,
        created: 2,
        skipped: 1,
        conflicts: [{ source: '/repo/.env', target: '/worktrees/feature/.env', reason: 'exists' }],
      },
      transactionOperations: operations,
      worktreePath: '/worktrees/feature',
      sampleLimit: 1,
    })

    expect(details).toEqual({
      rsync: {
        filesTransferred: 12,
        totalSize: 6789,
        duration: 234,
      },
      symlink: {
        created: 2,
        skipped: 1,
        conflictCount: 1,
        sampleLimit: 1,
        samples: [
          {
            path: 'package.json',
            source: '/repo/package.json',
            linkPath: '../repo/package.json',
          },
        ],
      },
    })
  })

  it('uses null sections for setup operations that did not run', () => {
    const details = buildAddCommandDetails({
      worktreePath: '/worktrees/feature',
    })

    expect(details).toEqual({
      rsync: null,
      symlink: null,
    })
  })
})
