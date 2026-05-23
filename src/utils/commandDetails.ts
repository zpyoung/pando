import * as path from 'path'
import type { Operation, RsyncResult, SymlinkResult } from './fileOps.js'
import { OperationType } from './fileOps.js'

export interface RsyncDetails {
  filesTransferred: number
  totalSize: number
  duration: number
}

export interface SymlinkSample {
  path: string
  source: string | null
  linkPath: string | null
}

export interface SymlinkDetails {
  created: number
  skipped: number
  conflictCount: number
  sampleLimit: number
  samples: SymlinkSample[]
}

export interface AddCommandDetails {
  rsync: RsyncDetails | null
  symlink: SymlinkDetails | null
}

export interface BuildAddCommandDetailsOptions {
  rsyncResult?: RsyncResult
  symlinkResult?: SymlinkResult
  transactionOperations?: Operation[]
  worktreePath: string
  sampleLimit?: number
}

export function buildAddCommandDetails({
  rsyncResult,
  symlinkResult,
  transactionOperations = [],
  worktreePath,
  sampleLimit = 5,
}: BuildAddCommandDetailsOptions): AddCommandDetails {
  const symlinkOps = transactionOperations.filter(
    (operation) => operation.type === OperationType.CREATE_SYMLINK
  )

  return {
    rsync: rsyncResult
      ? {
          filesTransferred: rsyncResult.filesTransferred,
          totalSize: rsyncResult.totalSize,
          duration: rsyncResult.duration,
        }
      : null,
    symlink: symlinkResult
      ? {
          created: symlinkResult.created,
          skipped: symlinkResult.skipped,
          conflictCount: symlinkResult.conflicts.length,
          sampleLimit,
          samples: symlinkOps.slice(0, sampleLimit).map((operation) => ({
            path: path.relative(worktreePath, operation.path),
            source: getStringMetadata(operation, 'source'),
            linkPath: getStringMetadata(operation, 'linkPath'),
          })),
        }
      : null,
  }
}

function getStringMetadata(operation: Operation, key: string): string | null {
  const value = operation.metadata?.[key]
  return typeof value === 'string' ? value : null
}
