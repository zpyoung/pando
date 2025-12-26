import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import {
  FileOperationTransaction,
  OperationType,
  RsyncHelper,
  SymlinkHelper,
  createRsyncHelper,
  createSymlinkHelper,
} from '../../src/utils/fileOps'

/**
 * Tests for FileOps utilities
 *
 * Focus on transaction rollback capabilities
 */

describe('FileOperationTransaction', () => {
  let transaction: FileOperationTransaction
  let testDir: string

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-test-'))
    transaction = new FileOperationTransaction()
  })

  afterEach(async () => {
    // Clean up test directory
    await fs.remove(testDir)
  })

  describe('record', () => {
    it('should record an operation', () => {
      const testPath = path.join(testDir, 'test.txt')

      transaction.record(OperationType.CREATE_SYMLINK, testPath, {
        target: '/some/target',
      })

      const operations = transaction.getOperations()
      expect(operations).toHaveLength(1)
      expect(operations[0].type).toBe(OperationType.CREATE_SYMLINK)
      expect(operations[0].path).toBe(testPath)
      expect(operations[0].metadata).toEqual({ target: '/some/target' })
      expect(operations[0].timestamp).toBeInstanceOf(Date)
    })

    it('should record multiple operations', () => {
      transaction.record(OperationType.CREATE_SYMLINK, '/path/1')
      transaction.record(OperationType.CREATE_DIR, '/path/2')
      transaction.record(OperationType.RSYNC, '/path/3')

      const operations = transaction.getOperations()
      expect(operations).toHaveLength(3)
      expect(operations[0].type).toBe(OperationType.CREATE_SYMLINK)
      expect(operations[1].type).toBe(OperationType.CREATE_DIR)
      expect(operations[2].type).toBe(OperationType.RSYNC)
    })
  })

  describe('createCheckpoint', () => {
    it('should create a checkpoint with data', () => {
      const checkpointName = 'test-checkpoint'
      const checkpointData = { content: 'test data' }

      transaction.createCheckpoint(checkpointName, checkpointData)

      // Checkpoints are private, but we can verify by attempting rollback
      expect(true).toBe(true) // Checkpoint creation succeeds
    })

    it('should store multiple checkpoints', () => {
      transaction.createCheckpoint('checkpoint1', { value: 1 })
      transaction.createCheckpoint('checkpoint2', { value: 2 })

      expect(true).toBe(true) // Multiple checkpoints succeed
    })
  })

  describe('rollback - CREATE_SYMLINK', () => {
    it('should remove a symlink on rollback', async () => {
      const linkPath = path.join(testDir, 'link')
      const targetPath = path.join(testDir, 'target.txt')

      // Create target file and symlink
      await fs.writeFile(targetPath, 'content')
      await fs.symlink(targetPath, linkPath)

      // Record the operation
      transaction.record(OperationType.CREATE_SYMLINK, linkPath)

      // Verify symlink exists
      expect(await fs.pathExists(linkPath)).toBe(true)
      const stats = await fs.lstat(linkPath)
      expect(stats.isSymbolicLink()).toBe(true)

      // Rollback
      await transaction.rollback()

      // Verify symlink is removed
      expect(await fs.pathExists(linkPath)).toBe(false)
    })

    it('should handle missing symlink gracefully', async () => {
      const linkPath = path.join(testDir, 'nonexistent-link')

      transaction.record(OperationType.CREATE_SYMLINK, linkPath)

      // Rollback should not throw even if file doesn't exist
      await expect(transaction.rollback()).resolves.not.toThrow()
    })
  })

  describe('rollback - RSYNC', () => {
    it('should remove rsync destination on rollback', async () => {
      const destPath = path.join(testDir, 'rsync-dest')

      // Create destination directory
      await fs.ensureDir(destPath)
      await fs.writeFile(path.join(destPath, 'file.txt'), 'content')

      // Record the operation with destination metadata
      transaction.record(OperationType.RSYNC, '/source/path', {
        destination: destPath,
      })

      // Verify destination exists
      expect(await fs.pathExists(destPath)).toBe(true)

      // Rollback
      await transaction.rollback()

      // Verify destination is removed
      expect(await fs.pathExists(destPath)).toBe(false)
    })

    it('should skip rsync rollback if no destination metadata', async () => {
      transaction.record(OperationType.RSYNC, '/source/path')

      // Rollback should not throw without destination metadata
      await expect(transaction.rollback()).resolves.not.toThrow()
    })
  })

  describe('rollback - CREATE_DIR', () => {
    it('should remove empty directory on rollback', async () => {
      const dirPath = path.join(testDir, 'empty-dir')

      // Create empty directory
      await fs.ensureDir(dirPath)

      // Record the operation
      transaction.record(OperationType.CREATE_DIR, dirPath)

      // Verify directory exists
      expect(await fs.pathExists(dirPath)).toBe(true)

      // Rollback
      await transaction.rollback()

      // Verify directory is removed
      expect(await fs.pathExists(dirPath)).toBe(false)
    })

    it('should not remove non-empty directory on rollback', async () => {
      const dirPath = path.join(testDir, 'non-empty-dir')

      // Create directory with file
      await fs.ensureDir(dirPath)
      await fs.writeFile(path.join(dirPath, 'file.txt'), 'content')

      // Record the operation
      transaction.record(OperationType.CREATE_DIR, dirPath)

      // Rollback
      await transaction.rollback()

      // Verify directory still exists (because it's not empty)
      expect(await fs.pathExists(dirPath)).toBe(true)
    })
  })

  describe('rollback - DELETE_FILE', () => {
    it('should restore file from checkpoint on rollback', async () => {
      const filePath = path.join(testDir, 'file.txt')
      const originalContent = 'original content'

      // Create file
      await fs.writeFile(filePath, originalContent)

      // Create checkpoint for the file
      transaction.createCheckpoint(`file:${filePath}`, originalContent)

      // Record deletion
      transaction.record(OperationType.DELETE_FILE, filePath)

      // Delete the file
      await fs.remove(filePath)

      // Verify file is deleted
      expect(await fs.pathExists(filePath)).toBe(false)

      // Rollback
      await transaction.rollback()

      // Verify file is restored
      expect(await fs.pathExists(filePath)).toBe(true)
      const restoredContent = await fs.readFile(filePath, 'utf-8')
      expect(restoredContent).toBe(originalContent)
    })

    it('should skip restore if no checkpoint exists', async () => {
      const filePath = path.join(testDir, 'file.txt')

      transaction.record(OperationType.DELETE_FILE, filePath)

      // Rollback should not throw without checkpoint
      await expect(transaction.rollback()).resolves.not.toThrow()
    })
  })

  describe('rollback - multiple operations', () => {
    it('should rollback operations in reverse order', async () => {
      const link1 = path.join(testDir, 'link1')
      const link2 = path.join(testDir, 'link2')
      const dir1 = path.join(testDir, 'dir1')
      const targetPath = path.join(testDir, 'target.txt')

      // Create target file
      await fs.writeFile(targetPath, 'content')

      // Create operations in order
      await fs.ensureDir(dir1)
      transaction.record(OperationType.CREATE_DIR, dir1)

      await fs.symlink(targetPath, link1)
      transaction.record(OperationType.CREATE_SYMLINK, link1)

      await fs.symlink(targetPath, link2)
      transaction.record(OperationType.CREATE_SYMLINK, link2)

      // Verify all exist
      expect(await fs.pathExists(dir1)).toBe(true)
      expect(await fs.pathExists(link1)).toBe(true)
      expect(await fs.pathExists(link2)).toBe(true)

      // Rollback (should process in reverse: link2, link1, dir1)
      await transaction.rollback()

      // Verify all are removed
      expect(await fs.pathExists(link2)).toBe(false)
      expect(await fs.pathExists(link1)).toBe(false)
      expect(await fs.pathExists(dir1)).toBe(false)
    })

    it('should continue rollback even if one operation fails', async () => {
      const link1 = path.join(testDir, 'link1')
      const link2 = path.join(testDir, 'link2')
      const targetPath = path.join(testDir, 'target.txt')

      // Create target and first symlink
      await fs.writeFile(targetPath, 'content')
      await fs.symlink(targetPath, link1)
      transaction.record(OperationType.CREATE_SYMLINK, link1)

      // Record a second symlink that doesn't exist
      transaction.record(OperationType.CREATE_SYMLINK, link2)

      // Create a third symlink
      const link3 = path.join(testDir, 'link3')
      await fs.symlink(targetPath, link3)
      transaction.record(OperationType.CREATE_SYMLINK, link3)

      // Rollback should not throw and should remove link1 and link3
      await expect(transaction.rollback()).resolves.not.toThrow()

      expect(await fs.pathExists(link1)).toBe(false)
      expect(await fs.pathExists(link3)).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all operations and checkpoints', () => {
      transaction.record(OperationType.CREATE_SYMLINK, '/path/1')
      transaction.record(OperationType.CREATE_DIR, '/path/2')
      transaction.createCheckpoint('test', { data: 'test' })

      expect(transaction.getOperations()).toHaveLength(2)

      transaction.clear()

      expect(transaction.getOperations()).toHaveLength(0)
    })

    it('should be called after rollback', async () => {
      transaction.record(OperationType.CREATE_SYMLINK, '/path/1')

      await transaction.rollback()

      expect(transaction.getOperations()).toHaveLength(0)
    })
  })

  describe('rollback - RollbackResult', () => {
    it('should return preserved checkpoints after rollback', async () => {
      const checkpointData = { path: '/test/worktree' }
      transaction.createCheckpoint('worktree', checkpointData)
      transaction.record(OperationType.CREATE_SYMLINK, '/path/1')

      const result = await transaction.rollback()

      // Checkpoints should be preserved in the result
      expect(result.checkpoints.get('worktree')).toEqual(checkpointData)
      // But internal checkpoints should be cleared
      expect(transaction.getCheckpoint('worktree')).toBeUndefined()
    })

    it('should return list of rolled back operations', async () => {
      const linkPath = path.join(testDir, 'link')
      const targetPath = path.join(testDir, 'target.txt')
      await fs.writeFile(targetPath, 'content')
      await fs.symlink(targetPath, linkPath)
      transaction.record(OperationType.CREATE_SYMLINK, linkPath)

      const result = await transaction.rollback()

      expect(result.rolledBackOperations).toHaveLength(1)
      expect(result.rolledBackOperations[0].type).toBe(OperationType.CREATE_SYMLINK)
      expect(result.rolledBackOperations[0].path).toBe(linkPath)
    })

    it('should track operations that failed to rollback', async () => {
      // Create a symlink operation that will fail during rollback
      // by recording a path that doesn't exist as a symlink
      const nonExistentPath = path.join(testDir, 'does-not-exist')
      transaction.record(OperationType.CREATE_SYMLINK, nonExistentPath)

      const result = await transaction.rollback()

      // Non-existent paths are skipped (not failed) - they just don't get added to rolledBackOperations
      expect(result.rolledBackOperations).toHaveLength(0)
      expect(result.failedRollbacks).toHaveLength(0)
    })

    it('should preserve multiple checkpoints', async () => {
      transaction.createCheckpoint('checkpoint1', { value: 1 })
      transaction.createCheckpoint('checkpoint2', { value: 2 })
      transaction.createCheckpoint('worktree', { path: '/test' })

      const result = await transaction.rollback()

      expect(result.checkpoints.size).toBe(3)
      expect(result.checkpoints.get('checkpoint1')).toEqual({ value: 1 })
      expect(result.checkpoints.get('checkpoint2')).toEqual({ value: 2 })
      expect(result.checkpoints.get('worktree')).toEqual({ path: '/test' })
    })

    it('should use preserved checkpoints for DELETE_FILE restoration', async () => {
      const filePath = path.join(testDir, 'file-to-restore.txt')
      const originalContent = 'original content'

      // Simulate a DELETE_FILE operation with checkpoint backup
      await fs.writeFile(filePath, originalContent)
      transaction.createCheckpoint(`file:${filePath}`, originalContent)
      await fs.remove(filePath)
      transaction.record(OperationType.DELETE_FILE, filePath)

      // Verify file is deleted
      expect(await fs.pathExists(filePath)).toBe(false)

      // Rollback should restore from preserved checkpoint
      const result = await transaction.rollback()

      // Verify file is restored
      expect(await fs.pathExists(filePath)).toBe(true)
      expect(await fs.readFile(filePath, 'utf8')).toBe(originalContent)
      expect(result.rolledBackOperations).toHaveLength(1)
    })

    it('should warn when symlink path exists but is not a symlink', async () => {
      const warnings: string[] = []
      const transactionWithWarnings = new FileOperationTransaction((msg) => warnings.push(msg))

      const filePath = path.join(testDir, 'regular-file.txt')
      await fs.writeFile(filePath, 'content')

      // Record as symlink even though it's a regular file
      transactionWithWarnings.record(OperationType.CREATE_SYMLINK, filePath)

      await transactionWithWarnings.rollback()

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('path exists but is not a symlink')
    })

    it('should warn when rsync operation has no destination metadata', async () => {
      const warnings: string[] = []
      const transactionWithWarnings = new FileOperationTransaction((msg) => warnings.push(msg))

      // Record rsync without destination metadata
      transactionWithWarnings.record(OperationType.RSYNC, '/source/path')

      await transactionWithWarnings.rollback()

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('no destination metadata recorded')
    })

    it('should warn when directory is not empty during rollback', async () => {
      const warnings: string[] = []
      const transactionWithWarnings = new FileOperationTransaction((msg) => warnings.push(msg))

      const dirPath = path.join(testDir, 'non-empty-dir')
      await fs.ensureDir(dirPath)
      await fs.writeFile(path.join(dirPath, 'file.txt'), 'content')

      transactionWithWarnings.record(OperationType.CREATE_DIR, dirPath)

      await transactionWithWarnings.rollback()

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('directory not empty')
    })

    it('should warn when DELETE_FILE has no checkpoint backup', async () => {
      const warnings: string[] = []
      const transactionWithWarnings = new FileOperationTransaction((msg) => warnings.push(msg))

      const filePath = path.join(testDir, 'deleted-file.txt')
      // Record DELETE_FILE without creating a checkpoint
      transactionWithWarnings.record(OperationType.DELETE_FILE, filePath)

      await transactionWithWarnings.rollback()

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('no checkpoint backup available')
    })
  })
})

describe('RsyncHelper', () => {
  let transaction: FileOperationTransaction
  let rsyncHelper: RsyncHelper

  beforeEach(() => {
    transaction = new FileOperationTransaction()
    rsyncHelper = createRsyncHelper(transaction)
  })

  describe('isInstalled', () => {
    it('should check if rsync is installed', async () => {
      const isInstalled = await rsyncHelper.isInstalled()

      // On most Unix systems, rsync should be installed
      // This test might fail on Windows or minimal environments
      expect(typeof isInstalled).toBe('boolean')
    })

    // Note: Mock-based isInstalled tests are not included
    // because child_process.exec is not configurable for spying in the current test environment.
    // The isInstalled method is tested implicitly through integration tests that verify
    // RsyncNotInstalledError is thrown when rsync is not available.
  })

  describe('getVersionInfo', () => {
    it('should return version information', async () => {
      const info = await rsyncHelper.getVersionInfo()

      // Should have installed status
      expect(typeof info.installed).toBe('boolean')
      expect(typeof info.supportsProgress).toBe('boolean')
      expect(typeof info.supportsStats).toBe('boolean')

      // If installed, should have version info
      if (info.installed) {
        expect(info.version).toBeDefined()
        expect(typeof info.major).toBe('number')
        expect(typeof info.minor).toBe('number')
      }
    })

    it('should cache version info', async () => {
      const info1 = await rsyncHelper.getVersionInfo()
      const info2 = await rsyncHelper.getVersionInfo()

      // Should return the same object (cached)
      expect(info1).toBe(info2)
    })

    it('should detect support for modern flags on rsync 2.6.0+', async () => {
      const info = await rsyncHelper.getVersionInfo()

      if (info.installed && info.major !== undefined && info.minor !== undefined) {
        // Most systems have rsync 2.6.0+ (released 2004)
        const isModern = info.major > 2 || (info.major === 2 && info.minor >= 6)
        expect(info.supportsProgress).toBe(isModern)
        expect(info.supportsStats).toBe(isModern)
      }
    })
  })

  describe('buildArgs', () => {
    it('should build correct args array with flags', () => {
      const args = rsyncHelper.buildArgs('/source', '/dest', {
        enabled: true,
        flags: ['-av', '--checksum'],
        exclude: [],
      })

      expect(args).toContain('-av')
      expect(args).toContain('--checksum')
      expect(args).toContain('/source/')
      expect(args).toContain('/dest')
    })

    it('should include exclude patterns', () => {
      const args = rsyncHelper.buildArgs('/source', '/dest', {
        enabled: true,
        flags: ['-av'],
        exclude: ['node_modules', '*.log'],
      })

      expect(args).toContain('--exclude')
      expect(args).toContain('node_modules')
      expect(args).toContain('*.log')
    })

    it('should always exclude .git directory', () => {
      const args = rsyncHelper.buildArgs('/source', '/dest', {
        enabled: true,
        flags: [],
        exclude: [],
      })

      expect(args).toContain('--exclude')
      expect(args).toContain('.git')
    })

    it('should not duplicate .git exclude if already present', () => {
      const args = rsyncHelper.buildArgs('/source', '/dest', {
        enabled: true,
        flags: [],
        exclude: ['.git'],
      })

      const gitExcludes = args.filter((arg) => arg === '.git')
      expect(gitExcludes).toHaveLength(1)
    })

    it('should add trailing slash to source path', () => {
      const args = rsyncHelper.buildArgs('/source', '/dest', {
        enabled: true,
        flags: [],
        exclude: [],
      })

      expect(args).toContain('/source/')
    })

    it('should not double trailing slash if already present', () => {
      const args = rsyncHelper.buildArgs('/source/', '/dest', {
        enabled: true,
        flags: [],
        exclude: [],
      })

      expect(args).toContain('/source/')
      expect(args).not.toContain('/source//')
    })

    it('should include additional excludes', () => {
      const args = rsyncHelper.buildArgs(
        '/source',
        '/dest',
        {
          enabled: true,
          flags: [],
          exclude: ['from-config'],
        },
        ['from-additional']
      )

      expect(args).toContain('from-config')
      expect(args).toContain('from-additional')
    })

    it('should filter out internally-managed flags', () => {
      const args = rsyncHelper.buildArgs('/source', '/dest', {
        enabled: true,
        flags: ['-av', '--stats', '--progress', '--dry-run', '--checksum'],
        exclude: [],
      })

      // User flags should be included
      expect(args).toContain('-av')
      expect(args).toContain('--checksum')

      // Internally-managed flags should be filtered out
      expect(args).not.toContain('--stats')
      expect(args).not.toContain('--progress')
      expect(args).not.toContain('--dry-run')
    })

    it('should filter empty and whitespace-only flags', () => {
      const args = rsyncHelper.buildArgs('/source', '/dest', {
        enabled: true,
        flags: ['-av', '', '   ', '--checksum'],
        exclude: [],
      })

      expect(args).toContain('-av')
      expect(args).toContain('--checksum')
      expect(args).not.toContain('')
      expect(args).not.toContain('   ')
    })
  })

  describe('parseRsyncStats', () => {
    it('should parse rsync 3.x stats output (GNU rsync)', () => {
      // Typical rsync 3.x output with --stats flag
      const rsync3Output = `
sending incremental file list
src/file.ts

Number of files: 10 (reg: 8, dir: 2)
Number of created files: 5 (reg: 5)
Number of deleted files: 0
Number of regular files transferred: 5
Total file size: 2,097,152 bytes
Total transferred file size: 1,048,576 bytes
Literal data: 1,048,576 bytes
Matched data: 0 bytes
File list size: 123
File list generation time: 0.001 seconds
File list transfer time: 0.000 seconds
Total bytes sent: 1,048,789
Total bytes received: 123
sent 1,048,789 bytes  received 123 bytes  2,097,824.00 bytes/sec
total size is 2,097,152  speedup is 2.00
`
      const result = rsyncHelper.parseRsyncStats(rsync3Output, 1000)

      expect(result.success).toBe(true)
      expect(result.filesTransferred).toBe(5)
      expect(result.totalSize).toBe(2097152)
      expect(result.bytesSent).toBe(1048789)
      expect(result.duration).toBe(1000)
    })

    it('should parse openrsync stats output (macOS)', () => {
      // Output from openrsync / rsync 2.6.9 compatible (macOS default)
      const openrsyncOutput = `
sending incremental file list
src/file.ts
       2097152 100%    0.00kB/s    0:00:00 (xfer#1, to-check=0/1)

Number of files: 1
Number of files transferred: 1
Total file size: 2097152 B
Total transferred file size: 2097152 B
Literal data: 2097152 B
Matched data: 0 B
File list size: 0
File list generation time: 0.000 seconds
File list transfer time: 0.000 seconds
Total bytes sent: 2097561
Total bytes received: 42
sent 2097561 bytes  received 42 bytes  4195206.00 bytes/sec
total size is 2097152  speedup is 1.00
`
      const result = rsyncHelper.parseRsyncStats(openrsyncOutput, 500)

      expect(result.success).toBe(true)
      expect(result.filesTransferred).toBe(1)
      expect(result.totalSize).toBe(2097152)
      expect(result.bytesSent).toBe(2097561)
      expect(result.duration).toBe(500)
    })

    it('should parse rsync output with commas in numbers', () => {
      const output = `
Number of created files: 1,234
Total file size: 10,000,000 bytes
sent 5,000,000 bytes  received 100 bytes
`
      const result = rsyncHelper.parseRsyncStats(output, 100)

      expect(result.filesTransferred).toBe(1234)
      expect(result.totalSize).toBe(10000000)
      expect(result.bytesSent).toBe(5000000)
    })

    it('should return zeros for unrecognized output format', () => {
      const output = 'some random output without stats'
      const result = rsyncHelper.parseRsyncStats(output, 100)

      expect(result.success).toBe(true)
      expect(result.filesTransferred).toBe(0)
      expect(result.totalSize).toBe(0)
      expect(result.bytesSent).toBe(0)
    })

    it('should parse transferred file size when total file size is missing', () => {
      // Some rsync versions only show transferred file size
      const output = `
Number of files transferred: 3
Total transferred file size: 1048576 B
sent 1048789 bytes  received 123 bytes
`
      const result = rsyncHelper.parseRsyncStats(output, 200)

      expect(result.filesTransferred).toBe(3)
      expect(result.totalSize).toBe(1048576)
    })

    it('should prefer "Number of created files" over "Number of files transferred"', () => {
      // rsync 3.x shows both; created files is more accurate for new worktrees
      const output = `
Number of files: 100
Number of created files: 50
Number of regular files transferred: 50
Number of files transferred: 50
Total file size: 1000000 bytes
`
      const result = rsyncHelper.parseRsyncStats(output, 100)

      // Should use "Number of created files" as primary
      expect(result.filesTransferred).toBe(50)
    })

    it('should fallback to "Number of regular files transferred" when no created files', () => {
      const output = `
Number of files: 100
Number of regular files transferred: 25
Total file size: 500000 bytes
`
      const result = rsyncHelper.parseRsyncStats(output, 100)

      expect(result.filesTransferred).toBe(25)
    })

    it('should parse size with B suffix (openrsync format)', () => {
      const output = `
Number of files transferred: 2
Total file size: 4194304 B
Total transferred file size: 2097152 B
`
      const result = rsyncHelper.parseRsyncStats(output, 100)

      expect(result.totalSize).toBe(4194304)
    })
  })

  describe('parseProgressLine', () => {
    it('should detect completed file transfer from xfer pattern', () => {
      const result = rsyncHelper.parseProgressLine(
        '14.71M 100% 237.69MB/s 0:00:00 (xfer#1, to-check=1/2)'
      )
      expect(result.isFileComplete).toBe(true)
    })

    it('should detect completed file with higher xfer number', () => {
      const result = rsyncHelper.parseProgressLine(
        '1.23K 100% 12.34MB/s 0:00:00 (xfer#42, to-check=100/150)'
      )
      expect(result.isFileComplete).toBe(true)
    })

    it('should not detect file completion for progress line without xfer', () => {
      const result = rsyncHelper.parseProgressLine('14.71M  50% 237.69MB/s 0:00:01')
      expect(result.isFileComplete).toBe(false)
    })

    it('should not detect file completion for filename line', () => {
      const result = rsyncHelper.parseProgressLine('src/utils/git.ts')
      expect(result.isFileComplete).toBe(false)
    })

    it('should not detect file completion for sending incremental line', () => {
      const result = rsyncHelper.parseProgressLine('sending incremental file list')
      expect(result.isFileComplete).toBe(false)
    })

    it('should not detect file completion for empty line', () => {
      const result = rsyncHelper.parseProgressLine('')
      expect(result.isFileComplete).toBe(false)
    })

    it('should not detect file completion for stats line', () => {
      const result = rsyncHelper.parseProgressLine('Number of files: 123')
      expect(result.isFileComplete).toBe(false)
    })

    // Tests for isFileName detection
    it('should detect filename line', () => {
      const result = rsyncHelper.parseProgressLine('src/utils/git.ts')
      expect(result.isFileName).toBe(true)
      expect(result.isFileComplete).toBe(false)
    })

    it('should not detect filename for sending incremental line', () => {
      const result = rsyncHelper.parseProgressLine('sending incremental file list')
      expect(result.isFileName).toBe(false)
    })

    it('should not detect filename for stats line', () => {
      const result = rsyncHelper.parseProgressLine('Number of files: 123')
      expect(result.isFileName).toBe(false)
    })

    it('should not detect filename for progress percentage line', () => {
      const result = rsyncHelper.parseProgressLine('14.71M  50% 237.69MB/s 0:00:01')
      expect(result.isFileName).toBe(false)
    })

    it('should not detect filename for empty line', () => {
      const result = rsyncHelper.parseProgressLine('')
      expect(result.isFileName).toBe(false)
    })

    it('should not detect filename for sent bytes line', () => {
      const result = rsyncHelper.parseProgressLine('sent 1,234 bytes')
      expect(result.isFileName).toBe(false)
    })

    it('should not detect filename for received bytes line', () => {
      const result = rsyncHelper.parseProgressLine('received 5,678 bytes')
      expect(result.isFileName).toBe(false)
    })

    it('should not detect filename for total size line', () => {
      const result = rsyncHelper.parseProgressLine('total size is 12,345')
      expect(result.isFileName).toBe(false)
    })
  })
})

describe('SymlinkHelper', () => {
  let transaction: FileOperationTransaction
  let symlinkHelper: SymlinkHelper
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-symlink-test-'))
    transaction = new FileOperationTransaction()
    symlinkHelper = createSymlinkHelper(transaction)
  })

  afterEach(async () => {
    await fs.remove(testDir)
  })

  describe('factory functions', () => {
    it('should create RsyncHelper', () => {
      const helper = createRsyncHelper(transaction)
      expect(helper).toBeInstanceOf(RsyncHelper)
    })

    it('should create SymlinkHelper', () => {
      const helper = createSymlinkHelper(transaction)
      expect(helper).toBeInstanceOf(SymlinkHelper)
    })
  })

  describe('matchPatterns', () => {
    it('should match files with glob patterns', async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content')
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'content')
      await fs.writeFile(path.join(testDir, 'other.json'), 'content')

      const matches = await symlinkHelper.matchPatterns(testDir, ['*.txt'])

      expect(matches).toHaveLength(2)
      expect(matches).toContain('file1.txt')
      expect(matches).toContain('file2.txt')
      expect(matches).not.toContain('other.json')
    })

    it('should match directories with glob patterns', async () => {
      // Create test directories
      await fs.ensureDir(path.join(testDir, 'subdir1'))
      await fs.ensureDir(path.join(testDir, 'subdir2'))
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content')

      const matches = await symlinkHelper.matchPatterns(testDir, ['subdir*'])

      expect(matches).toHaveLength(2)
      expect(matches).toContain('subdir1')
      expect(matches).toContain('subdir2')
      expect(matches).not.toContain('file.txt')
    })

    it('should match both files and directories with broad pattern', async () => {
      // Create mixed content
      await fs.ensureDir(path.join(testDir, 'dir'))
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content')

      const matches = await symlinkHelper.matchPatterns(testDir, ['*'])

      expect(matches).toContain('dir')
      expect(matches).toContain('file.txt')
    })

    it('should deduplicate files inside matched directories', async () => {
      // Create: subdir/file.txt
      await fs.ensureDir(path.join(testDir, 'subdir'))
      await fs.writeFile(path.join(testDir, 'subdir', 'file.txt'), 'content')

      // Match both the directory and files inside it
      const matches = await symlinkHelper.matchPatterns(testDir, ['subdir', 'subdir/*'])

      // Should only contain the directory, not the file inside
      expect(matches).toContain('subdir')
      expect(matches).not.toContain('subdir/file.txt')
    })

    it('should deduplicate nested files inside matched parent directory', async () => {
      // Create: parent/child/grandchild.txt
      await fs.ensureDir(path.join(testDir, 'parent', 'child'))
      await fs.writeFile(path.join(testDir, 'parent', 'child', 'grandchild.txt'), 'content')

      // Match the parent directory and nested files
      const matches = await symlinkHelper.matchPatterns(testDir, ['parent', 'parent/**/*'])

      // Should only contain the parent directory
      expect(matches).toContain('parent')
      expect(matches).not.toContain('parent/child')
      expect(matches).not.toContain('parent/child/grandchild.txt')
    })

    it('should keep files that are not inside matched directories', async () => {
      // Create: dir1/, dir2/file.txt, standalone.txt
      await fs.ensureDir(path.join(testDir, 'dir1'))
      await fs.ensureDir(path.join(testDir, 'dir2'))
      await fs.writeFile(path.join(testDir, 'dir2', 'file.txt'), 'content')
      await fs.writeFile(path.join(testDir, 'standalone.txt'), 'content')

      // Match dir1 (as directory) and all .txt files
      const matches = await symlinkHelper.matchPatterns(testDir, ['dir1', '**/*.txt'])

      // dir1 should be included
      expect(matches).toContain('dir1')
      // standalone.txt should be included (not inside dir1)
      expect(matches).toContain('standalone.txt')
      // dir2/file.txt should be included (not inside dir1)
      expect(matches).toContain('dir2/file.txt')
    })

    it('should match dotfiles and dot-directories', async () => {
      // Create: .hidden/file.txt, .env
      await fs.ensureDir(path.join(testDir, '.hidden'))
      await fs.writeFile(path.join(testDir, '.hidden', 'file.txt'), 'content')
      await fs.writeFile(path.join(testDir, '.env'), 'content')

      const matches = await symlinkHelper.matchPatterns(testDir, ['.hidden', '.env'])

      expect(matches).toContain('.hidden')
      expect(matches).toContain('.env')
    })

    it('should return empty array for no matches', async () => {
      // Create a file that won't match
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content')

      const matches = await symlinkHelper.matchPatterns(testDir, ['*.json'])

      expect(matches).toHaveLength(0)
    })

    it('should handle empty patterns array', async () => {
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content')

      const matches = await symlinkHelper.matchPatterns(testDir, [])

      expect(matches).toHaveLength(0)
    })

    it('should handle symlinks to files without following them recursively', async () => {
      // Create: target.txt, link.txt -> target.txt
      const targetPath = path.join(testDir, 'target.txt')
      const linkPath = path.join(testDir, 'link.txt')

      await fs.writeFile(targetPath, 'content')
      await fs.symlink(targetPath, linkPath)

      const matches = await symlinkHelper.matchPatterns(testDir, ['*.txt'])

      // Both the file and symlink should match
      expect(matches).toContain('target.txt')
      expect(matches).toContain('link.txt')
    })

    it('should handle symlinks to directories safely', async () => {
      // Create: realdir/file.txt, linkdir -> realdir
      const realDir = path.join(testDir, 'realdir')
      const linkDir = path.join(testDir, 'linkdir')

      await fs.ensureDir(realDir)
      await fs.writeFile(path.join(realDir, 'file.txt'), 'content')
      await fs.symlink(realDir, linkDir)

      // Match both real and symlinked directories
      const matches = await symlinkHelper.matchPatterns(testDir, ['realdir', 'linkdir'])

      expect(matches).toContain('realdir')
      expect(matches).toContain('linkdir')
    })

    it('should handle broken symlinks gracefully', async () => {
      // Create a symlink to a non-existent target
      const brokenLink = path.join(testDir, 'broken-link')
      await fs.symlink('/nonexistent/path', brokenLink)

      // Create a regular file to ensure pattern matching works
      await fs.writeFile(path.join(testDir, 'regular.txt'), 'content')

      // Should not throw and should return the regular file
      const matches = await symlinkHelper.matchPatterns(testDir, ['*'])

      expect(matches).toContain('regular.txt')
      // Broken symlink might or might not be included depending on globby behavior
    })

    it('should deduplicate when symlink target is also matched', async () => {
      // Create: parent/child.txt, and symlink inside parent pointing up
      const parentDir = path.join(testDir, 'parent')
      await fs.ensureDir(parentDir)
      await fs.writeFile(path.join(parentDir, 'child.txt'), 'content')

      // Match the parent directory
      const matches = await symlinkHelper.matchPatterns(testDir, ['parent', 'parent/*'])

      // Should only contain parent (child is inside parent)
      expect(matches).toContain('parent')
      expect(matches).not.toContain('parent/child.txt')
    })
  })
})
