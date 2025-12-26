/**
 * Utility functions for branch backup operations
 *
 * Provides timestamp formatting and backup branch name parsing
 * for the backup/restore commands.
 */

import type { CommitLogEntry } from './git.js'

/** Backup branch naming convention: backup/<sourceBranch>/<timestamp> */
export const BACKUP_PREFIX = 'backup/'

/**
 * Format a Date as a backup timestamp string
 *
 * @param date - Date to format (defaults to now)
 * @returns Timestamp string in format YYYYMMDD-HHmmss (UTC)
 */
export function formatBackupTimestamp(date: Date = new Date()): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')

  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

/**
 * Convert a Date to ISO string with seconds precision (no milliseconds)
 *
 * @param date - Date to convert
 * @returns ISO string without milliseconds (e.g., 2025-01-17T15:30:45Z)
 */
export function toIsoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Generate a backup branch name for a source branch
 *
 * @param sourceBranch - Name of the branch being backed up
 * @param date - Date for the timestamp (defaults to now)
 * @returns Full backup branch name (e.g., backup/feature/20250117-153045)
 */
export function generateBackupBranchName(sourceBranch: string, date: Date = new Date()): string {
  const timestamp = formatBackupTimestamp(date)
  return `${BACKUP_PREFIX}${sourceBranch}/${timestamp}`
}

/**
 * Parsed result from a backup branch name
 */
export interface ParsedBackupBranch {
  sourceBranch: string
  timestamp: string
}

/**
 * Parse a backup branch name to extract source branch and timestamp
 *
 * @param branchName - Full backup branch name (e.g., backup/feature/20250117-153045)
 * @returns Parsed info or null if not a valid backup branch name
 */
export function parseBackupBranchName(branchName: string): ParsedBackupBranch | null {
  if (!branchName.startsWith(BACKUP_PREFIX)) {
    return null
  }

  const withoutPrefix = branchName.slice(BACKUP_PREFIX.length)

  // Find the last slash - everything before is source branch, after is timestamp
  const lastSlashIndex = withoutPrefix.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return null
  }

  const sourceBranch = withoutPrefix.slice(0, lastSlashIndex)
  const timestampStr = withoutPrefix.slice(lastSlashIndex + 1)

  // Validate timestamp format: YYYYMMDD-HHmmss
  const match = timestampStr.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  if (!match) {
    return null
  }

  // Validate it's a real date
  const [, year, month, day, hour, minute, second] = match
  const isoStr = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  const date = new Date(isoStr)
  if (isNaN(date.getTime())) {
    return null
  }

  return {
    sourceBranch,
    timestamp: timestampStr,
  }
}

/**
 * Check if a branch name is a valid backup branch for a specific source
 *
 * @param backupName - Branch name to check
 * @param sourceBranch - Expected source branch
 * @returns True if backupName is a valid backup of sourceBranch
 */
export function isBackupOf(backupName: string, sourceBranch: string): boolean {
  const parsed = parseBackupBranchName(backupName)
  return parsed !== null && parsed.sourceBranch === sourceBranch
}

/**
 * Format a relative time string for display (e.g., "2 hours ago")
 *
 * @param date - Date to format relative to now
 * @returns Human-readable relative time string
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`
  }
  if (diffHours > 0) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
  }
  if (diffMinutes > 0) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`
  }
  return 'just now'
}

/**
 * Convert a backup timestamp string to a Date object
 *
 * @param timestampStr - Timestamp in format YYYYMMDD-HHmmss
 * @returns Date object or null if invalid
 */
export function parseBackupTimestamp(timestampStr: string): Date | null {
  const match = timestampStr.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)

  return isNaN(date.getTime()) ? null : date
}

/**
 * Options for formatting commit tree display
 */
export interface FormatCommitTreeOptions {
  /** Commits that will become unreachable (lost) */
  lostCommits: { commits: CommitLogEntry[]; totalCount: number } | null
  /** Commits that will be restored (gained) */
  gainedCommits: { commits: CommitLogEntry[]; totalCount: number } | null
  /** Chalk instance for terminal colors */
  chalk: typeof import('chalk').default
}

/**
 * Result of formatting the commit tree
 */
export interface CommitTreeOutput {
  /** Lines to display in the terminal */
  lines: string[]
  /** Data for JSON output */
  json: {
    lostCommits?: { commits: Array<{ hash: string; message: string }>; total: number }
    gainedCommits?: { commits: Array<{ hash: string; message: string }>; total: number }
  }
}

/** Maximum message length before truncation */
const MAX_MESSAGE_LENGTH = 72

/**
 * Truncate a message if it exceeds the maximum length
 */
function truncateMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message
  }
  return message.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
}

/**
 * Format commit tree for display in restore confirmation
 *
 * Shows commits that will be lost and gained during restore:
 * - Lost commits: shown with `-` prefix in red
 * - Gained commits: shown with `+` prefix in green
 *
 * @param options - Formatting options with commit data and chalk instance
 * @returns Formatted lines for terminal display and data for JSON output
 */
export function formatCommitTree(options: FormatCommitTreeOptions): CommitTreeOutput {
  const { lostCommits, gainedCommits, chalk } = options
  const lines: string[] = []
  const json: CommitTreeOutput['json'] = {}

  // Format lost commits (commits that will become unreachable)
  if (lostCommits && lostCommits.totalCount > 0) {
    lines.push('')
    lines.push(chalk.red(`  Commits that will become unreachable (${lostCommits.totalCount}):`))

    for (const commit of lostCommits.commits) {
      const msg = truncateMessage(commit.message)
      lines.push(chalk.red(`    - ${commit.hash} ${msg}`))
    }

    if (lostCommits.totalCount > lostCommits.commits.length) {
      const remaining = lostCommits.totalCount - lostCommits.commits.length
      lines.push(chalk.red(`    ...and ${remaining} more`))
    }

    json.lostCommits = {
      commits: lostCommits.commits.map((c) => ({ hash: c.hash, message: c.message })),
      total: lostCommits.totalCount,
    }
  }

  // Format gained commits (commits that will be restored)
  if (gainedCommits && gainedCommits.totalCount > 0) {
    lines.push('')
    lines.push(chalk.green(`  Commits that will be restored (${gainedCommits.totalCount}):`))

    for (const commit of gainedCommits.commits) {
      const msg = truncateMessage(commit.message)
      lines.push(chalk.green(`    + ${commit.hash} ${msg}`))
    }

    if (gainedCommits.totalCount > gainedCommits.commits.length) {
      const remaining = gainedCommits.totalCount - gainedCommits.commits.length
      lines.push(chalk.green(`    ...and ${remaining} more`))
    }

    json.gainedCommits = {
      commits: gainedCommits.commits.map((c) => ({ hash: c.hash, message: c.message })),
      total: gainedCommits.totalCount,
    }
  }

  return { lines, json }
}
