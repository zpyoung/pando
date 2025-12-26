import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatBackupTimestamp,
  toIsoSeconds,
  generateBackupBranchName,
  parseBackupBranchName,
  isBackupOf,
  formatRelativeTime,
  parseBackupTimestamp,
  formatCommitTree,
  BACKUP_PREFIX,
} from '../../src/utils/branch-backups'

// Mock chalk for tests - wraps text with markers for verification
const mockChalk = {
  red: (s: string) => `[RED]${s}[/RED]`,
  green: (s: string) => `[GREEN]${s}[/GREEN]`,
} as unknown as typeof import('chalk').default

describe('branch-backups utilities', () => {
  describe('BACKUP_PREFIX', () => {
    it('should be backup/', () => {
      expect(BACKUP_PREFIX).toBe('backup/')
    })
  })

  describe('formatBackupTimestamp', () => {
    it('should format date as YYYYMMDD-HHmmss in UTC', () => {
      const date = new Date('2025-01-17T15:30:45Z')
      const result = formatBackupTimestamp(date)
      expect(result).toBe('20250117-153045')
    })

    it('should pad single digit values', () => {
      const date = new Date('2025-01-05T09:03:07Z')
      const result = formatBackupTimestamp(date)
      expect(result).toBe('20250105-090307')
    })

    it('should use current time when no date provided', () => {
      const before = new Date()
      const result = formatBackupTimestamp()
      const after = new Date()

      // Parse the result and verify it's within the test window
      const match = result.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
      expect(match).not.toBeNull()

      const [, year, month, day, hour, minute, second] = match!
      const parsedDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)

      expect(parsedDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
      expect(parsedDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000)
    })
  })

  describe('toIsoSeconds', () => {
    it('should convert date to ISO string without milliseconds', () => {
      const date = new Date('2025-01-17T15:30:45.123Z')
      const result = toIsoSeconds(date)
      expect(result).toBe('2025-01-17T15:30:45Z')
    })

    it('should handle date with no milliseconds', () => {
      const date = new Date('2025-01-17T15:30:45.000Z')
      const result = toIsoSeconds(date)
      expect(result).toBe('2025-01-17T15:30:45Z')
    })
  })

  describe('generateBackupBranchName', () => {
    it('should generate backup branch name with timestamp', () => {
      const date = new Date('2025-01-17T15:30:45Z')
      const result = generateBackupBranchName('feature', date)
      expect(result).toBe('backup/feature/20250117-153045')
    })

    it('should handle nested branch names', () => {
      const date = new Date('2025-01-17T15:30:45Z')
      const result = generateBackupBranchName('feature/auth', date)
      expect(result).toBe('backup/feature/auth/20250117-153045')
    })

    it('should use current time when no date provided', () => {
      const result = generateBackupBranchName('main')
      expect(result).toMatch(/^backup\/main\/\d{8}-\d{6}$/)
    })
  })

  describe('parseBackupBranchName', () => {
    it('should parse valid backup branch name', () => {
      const result = parseBackupBranchName('backup/feature/20250117-153045')
      expect(result).toEqual({
        sourceBranch: 'feature',
        timestamp: '20250117-153045',
      })
    })

    it('should parse nested source branch names', () => {
      const result = parseBackupBranchName('backup/feature/auth/20250117-153045')
      expect(result).toEqual({
        sourceBranch: 'feature/auth',
        timestamp: '20250117-153045',
      })
    })

    it('should parse deeply nested source branch names', () => {
      const result = parseBackupBranchName('backup/feature/auth/v2/impl/20250117-153045')
      expect(result).toEqual({
        sourceBranch: 'feature/auth/v2/impl',
        timestamp: '20250117-153045',
      })
    })

    it('should return null for non-backup branch', () => {
      const result = parseBackupBranchName('feature/auth')
      expect(result).toBeNull()
    })

    it('should return null for branch without timestamp', () => {
      const result = parseBackupBranchName('backup/feature')
      expect(result).toBeNull()
    })

    it('should return null for invalid timestamp format', () => {
      const result = parseBackupBranchName('backup/feature/2025-01-17')
      expect(result).toBeNull()
    })

    it('should return null for invalid date values', () => {
      // Month 13 is invalid
      const result = parseBackupBranchName('backup/feature/20251317-153045')
      expect(result).toBeNull()
    })
  })

  describe('isBackupOf', () => {
    it('should return true for valid backup of source branch', () => {
      const result = isBackupOf('backup/feature/20250117-153045', 'feature')
      expect(result).toBe(true)
    })

    it('should return true for nested source branch', () => {
      const result = isBackupOf('backup/feature/auth/20250117-153045', 'feature/auth')
      expect(result).toBe(true)
    })

    it('should return false for different source branch', () => {
      const result = isBackupOf('backup/feature/20250117-153045', 'main')
      expect(result).toBe(false)
    })

    it('should return false for non-backup branch', () => {
      const result = isBackupOf('feature', 'feature')
      expect(result).toBe(false)
    })

    it('should return false for backup with partial source match', () => {
      // backup/feature-auth is NOT a backup of feature
      const result = isBackupOf('backup/feature-auth/20250117-153045', 'feature')
      expect(result).toBe(false)
    })
  })

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-17T15:30:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return "just now" for very recent times', () => {
      const date = new Date('2025-01-17T15:29:30Z')
      const result = formatRelativeTime(date)
      expect(result).toBe('just now')
    })

    it('should return "1 minute ago" for 1 minute', () => {
      const date = new Date('2025-01-17T15:29:00Z')
      const result = formatRelativeTime(date)
      expect(result).toBe('1 minute ago')
    })

    it('should return "X minutes ago" for multiple minutes', () => {
      const date = new Date('2025-01-17T15:15:00Z')
      const result = formatRelativeTime(date)
      expect(result).toBe('15 minutes ago')
    })

    it('should return "1 hour ago" for 1 hour', () => {
      const date = new Date('2025-01-17T14:30:00Z')
      const result = formatRelativeTime(date)
      expect(result).toBe('1 hour ago')
    })

    it('should return "X hours ago" for multiple hours', () => {
      const date = new Date('2025-01-17T10:30:00Z')
      const result = formatRelativeTime(date)
      expect(result).toBe('5 hours ago')
    })

    it('should return "1 day ago" for 1 day', () => {
      const date = new Date('2025-01-16T15:30:00Z')
      const result = formatRelativeTime(date)
      expect(result).toBe('1 day ago')
    })

    it('should return "X days ago" for multiple days', () => {
      const date = new Date('2025-01-14T15:30:00Z')
      const result = formatRelativeTime(date)
      expect(result).toBe('3 days ago')
    })
  })

  describe('parseBackupTimestamp', () => {
    it('should parse valid timestamp to Date', () => {
      const result = parseBackupTimestamp('20250117-153045')
      expect(result).toEqual(new Date('2025-01-17T15:30:45Z'))
    })

    it('should return null for invalid format', () => {
      const result = parseBackupTimestamp('2025-01-17')
      expect(result).toBeNull()
    })

    it('should return null for invalid date values', () => {
      const result = parseBackupTimestamp('20251317-153045')
      expect(result).toBeNull()
    })

    it('should return null for too short string', () => {
      const result = parseBackupTimestamp('20250117')
      expect(result).toBeNull()
    })
  })

  describe('formatCommitTree', () => {
    it('should format lost commits with red prefix', () => {
      const result = formatCommitTree({
        lostCommits: {
          commits: [
            { hash: 'abc1234', message: 'Lost commit 1' },
            { hash: 'def5678', message: 'Lost commit 2' },
          ],
          totalCount: 2,
        },
        gainedCommits: null,
        chalk: mockChalk,
      })

      expect(result.lines).toContain('[RED]  Commits that will become unreachable (2):[/RED]')
      expect(result.lines).toContain('[RED]    - abc1234 Lost commit 1[/RED]')
      expect(result.lines).toContain('[RED]    - def5678 Lost commit 2[/RED]')
      expect(result.json.lostCommits).toEqual({
        commits: [
          { hash: 'abc1234', message: 'Lost commit 1' },
          { hash: 'def5678', message: 'Lost commit 2' },
        ],
        total: 2,
      })
    })

    it('should format gained commits with green prefix', () => {
      const result = formatCommitTree({
        lostCommits: null,
        gainedCommits: {
          commits: [{ hash: 'ghi9012', message: 'Gained commit' }],
          totalCount: 1,
        },
        chalk: mockChalk,
      })

      expect(result.lines).toContain('[GREEN]  Commits that will be restored (1):[/GREEN]')
      expect(result.lines).toContain('[GREEN]    + ghi9012 Gained commit[/GREEN]')
      expect(result.json.gainedCommits).toEqual({
        commits: [{ hash: 'ghi9012', message: 'Gained commit' }],
        total: 1,
      })
    })

    it('should show "...and N more" when commits exceed limit', () => {
      const result = formatCommitTree({
        lostCommits: {
          commits: [{ hash: 'abc1234', message: 'Commit' }],
          totalCount: 15,
        },
        gainedCommits: null,
        chalk: mockChalk,
      })

      expect(result.lines).toContain('[RED]    ...and 14 more[/RED]')
    })

    it('should handle both lost and gained commits', () => {
      const result = formatCommitTree({
        lostCommits: {
          commits: [{ hash: 'abc1234', message: 'Lost' }],
          totalCount: 1,
        },
        gainedCommits: {
          commits: [{ hash: 'def5678', message: 'Gained' }],
          totalCount: 1,
        },
        chalk: mockChalk,
      })

      expect(result.lines.some((l) => l.includes('unreachable'))).toBe(true)
      expect(result.lines.some((l) => l.includes('restored'))).toBe(true)
      expect(result.json.lostCommits).toBeDefined()
      expect(result.json.gainedCommits).toBeDefined()
    })

    it('should return empty output when no commits', () => {
      const result = formatCommitTree({
        lostCommits: null,
        gainedCommits: { commits: [], totalCount: 0 },
        chalk: mockChalk,
      })

      expect(result.lines).toHaveLength(0)
      expect(result.json).toEqual({})
    })

    it('should skip section when totalCount is 0', () => {
      const result = formatCommitTree({
        lostCommits: { commits: [], totalCount: 0 },
        gainedCommits: null,
        chalk: mockChalk,
      })

      expect(result.lines).toHaveLength(0)
      expect(result.json.lostCommits).toBeUndefined()
    })

    it('should truncate long messages', () => {
      const longMessage = 'A'.repeat(100)
      const result = formatCommitTree({
        lostCommits: {
          commits: [{ hash: 'abc1234', message: longMessage }],
          totalCount: 1,
        },
        gainedCommits: null,
        chalk: mockChalk,
      })

      // The display line should be truncated (72 chars max, ending with ...)
      const commitLine = result.lines.find((l) => l.includes('abc1234'))
      expect(commitLine).toBeDefined()
      expect(commitLine!.includes('...')).toBe(true)

      // But JSON should have full message
      expect(result.json.lostCommits?.commits[0].message).toBe(longMessage)
    })
  })
})
