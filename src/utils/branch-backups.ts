/**
 * Utility functions for branch backup operations
 *
 * Provides timestamp formatting and backup branch name parsing
 * for the backup/restore commands.
 */

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
