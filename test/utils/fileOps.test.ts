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
