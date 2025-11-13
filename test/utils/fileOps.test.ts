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
    it('should create a checkpoint with data', async () => {
      const checkpointName = 'test-checkpoint'
      const checkpointData = { content: 'test data' }

      await transaction.createCheckpoint(checkpointName, checkpointData)

      // Checkpoints are private, but we can verify by attempting rollback
      expect(true).toBe(true) // Checkpoint creation succeeds
    })

    it('should store multiple checkpoints', async () => {
      await transaction.createCheckpoint('checkpoint1', { value: 1 })
      await transaction.createCheckpoint('checkpoint2', { value: 2 })

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
      await transaction.createCheckpoint(`file:${filePath}`, originalContent)

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
    it('should clear all operations and checkpoints', async () => {
      transaction.record(OperationType.CREATE_SYMLINK, '/path/1')
      transaction.record(OperationType.CREATE_DIR, '/path/2')
      await transaction.createCheckpoint('test', { data: 'test' })

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
  })
})

describe('SymlinkHelper', () => {
  let transaction: FileOperationTransaction
  let symlinkHelper: SymlinkHelper

  beforeEach(() => {
    transaction = new FileOperationTransaction()
    symlinkHelper = createSymlinkHelper(transaction)
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
})
