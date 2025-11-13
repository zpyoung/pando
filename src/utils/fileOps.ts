import * as fs from 'fs-extra'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { RsyncConfig, SymlinkConfig } from '../config/schema'

const execAsync = promisify(exec)

/**
 * File Operations Utilities
 *
 * Handles rsync and symlink operations with transaction support
 * for rollback capabilities.
 */

// ============================================================================
// Custom Errors
// ============================================================================

/**
 * Error thrown when rsync is not installed
 */
export class RsyncNotInstalledError extends Error {
  constructor() {
    super('rsync is not installed or not in PATH')
    this.name = 'RsyncNotInstalledError'
  }
}

/**
 * Error thrown when symlink creation encounters a conflict
 */
export class SymlinkConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: Array<{ source: string; target: string; reason: string }>
  ) {
    super(message)
    this.name = 'SymlinkConflictError'
  }
}

/**
 * Error thrown when file operations fail
 */
export class FileOperationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'FileOperationError'
  }
}

// ============================================================================
// Transaction Tracking
// ============================================================================

/**
 * Operation types for transaction tracking
 */
export enum OperationType {
  CREATE_SYMLINK = 'create_symlink',
  RSYNC = 'rsync',
  CREATE_DIR = 'create_dir',
  DELETE_FILE = 'delete_file',
}

/**
 * A tracked operation for rollback
 */
export interface Operation {
  type: OperationType
  path: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

/**
 * Transaction for tracking file operations
 *
 * Enables rollback of all operations if any step fails.
 */
export class FileOperationTransaction {
  private operations: Operation[] = []
  private checkpoints: Map<string, unknown> = new Map()

  /**
   * Record an operation
   */
  record(type: OperationType, path: string, metadata?: Record<string, unknown>): void {
    // TODO: Implement operation recording
    // Add operation to operations array with timestamp
    this.operations.push({
      type,
      path,
      metadata,
      timestamp: new Date(),
    })
  }

  /**
   * Create a checkpoint (snapshot state for potential rollback)
   */
  createCheckpoint(name: string, data: any): void {
    // TODO: Implement checkpoint creation
    // Store snapshot of current state
    // Used for rollback if needed
    this.checkpoints.set(name, data)
  }

  /**
   * Get all recorded operations
   */
  getOperations(): Operation[] {
    return [...this.operations]
  }

  /**
   * Rollback all operations in reverse order
   */
  async rollback(): Promise<void> {
    // Iterate operations in reverse order
    const reversedOps = [...this.operations].reverse()

    for (const op of reversedOps) {
      try {
        switch (op.type) {
          case OperationType.CREATE_SYMLINK:
            // Remove symlink if it exists
            if (await fs.pathExists(op.path)) {
              const stats = await fs.lstat(op.path)
              if (stats.isSymbolicLink()) {
                await fs.unlink(op.path)
              }
            }
            break

          case OperationType.RSYNC:
            // For rsync, we need to remove the destination
            // This is tricky - we can only remove if we have metadata about what was created
            if (op.metadata?.destination) {
              const dest = op.metadata.destination as string
              if (await fs.pathExists(dest)) {
                await fs.remove(dest)
              }
            }
            break

          case OperationType.CREATE_DIR:
            // Remove directory if it exists and is empty
            if (await fs.pathExists(op.path)) {
              try {
                const items = await fs.readdir(op.path)
                if (items.length === 0) {
                  await fs.rmdir(op.path)
                }
              } catch {
                // Directory not empty or other error - skip
              }
            }
            break

          case OperationType.DELETE_FILE:
            // Restore from checkpoint if available
            const checkpointKey = `file:${op.path}`
            if (this.checkpoints.has(checkpointKey)) {
              const content = this.checkpoints.get(checkpointKey)
              await fs.writeFile(op.path, content)
            }
            break
        }
      } catch (error) {
        // Log error but continue rolling back other operations
        console.warn(`Failed to rollback operation ${op.type} at ${op.path}:`, error)
      }
    }

    // Clear operations after rollback
    this.clear()
  }

  /**
   * Clear all tracked operations
   */
  clear(): void {
    this.operations = []
    this.checkpoints.clear()
  }
}

// ============================================================================
// Rsync Helper
// ============================================================================

/**
 * Helper for rsync operations
 */
export class RsyncHelper {
  constructor(private transaction: FileOperationTransaction) {}

  /**
   * Check if rsync is installed and available
   */
  async isInstalled(): Promise<boolean> {
    // TODO: Implement rsync installation check
    // Run: rsync --version
    // Return true if succeeds, false if fails
    try {
      await execAsync('rsync --version')
      return true
    } catch {
      return false
    }
  }

  /**
   * Build rsync command from configuration
   */
  buildCommand(
    _source: string,
    _destination: string,
    _config: RsyncConfig,
    _additionalExcludes: string[] = []
  ): string {
    // TODO: Implement command builder
    // 1. Start with 'rsync'
    // 2. Add flags from config.flags
    // 3. Add excludes from config.exclude
    // 4. Add additionalExcludes
    // 5. Always exclude .git directory
    // 6. Add source and destination paths (quote if needed)
    // 7. Return complete command string

    throw new Error('Not implemented')
  }

  /**
   * Execute rsync from source to destination
   */
  rsync(
    _source: string,
    _destination: string,
    _config: RsyncConfig,
    _options: {
      excludePatterns?: string[]
      onProgress?: (output: string) => void
    } = {}
  ): Promise<RsyncResult> {
    // TODO: Implement rsync execution
    // 1. Check if rsync is installed (throw RsyncNotInstalledError if not)
    // 2. Build rsync command
    // 3. Execute command (use spawn for progress streaming)
    // 4. Track operation in transaction
    // 5. Parse output for statistics
    // 6. Return result with file counts

    throw new Error('Not implemented')
  }

  /**
   * Get estimated file count for rsync
   */
  estimateFileCount(_source: string, _config: RsyncConfig): Promise<number> {
    // TODO: Implement file count estimation
    // Run rsync with --dry-run and count files
    // Used for progress indicators
    throw new Error('Not implemented')
  }
}

/**
 * Result of rsync operation
 */
export interface RsyncResult {
  success: boolean
  filesTransferred: number
  bytesSent: number
  totalSize: number
  duration: number
}

// ============================================================================
// Symlink Helper
// ============================================================================

/**
 * Helper for symlink operations
 */
export class SymlinkHelper {
  constructor(private transaction: FileOperationTransaction) {}

  /**
   * Match files against glob patterns
   */
  matchPatterns(_baseDir: string, _patterns: string[]): Promise<string[]> {
    // TODO: Implement pattern matching
    // 1. Use globby to match patterns in baseDir
    // 2. Return array of matched file paths (relative to baseDir)
    // 3. Filter out directories (only match files)
    // 4. Handle errors gracefully

    throw new Error('Not implemented')
  }

  /**
   * Detect conflicts (files that exist at target path)
   */
  detectConflicts(
    _links: Array<{ source: string; target: string }>
  ): Promise<Array<{ source: string; target: string; reason: string }>> {
    // TODO: Implement conflict detection
    // 1. For each link, check if target exists
    // 2. If exists, determine reason (file, directory, symlink)
    // 3. Return array of conflicts
    // 4. Empty array if no conflicts

    throw new Error('Not implemented')
  }

  /**
   * Create a single symlink
   */
  createSymlink(
    _source: string,
    _target: string,
    _options: {
      relative?: boolean
      replaceExisting?: boolean
    } = {}
  ): Promise<void> {
    // TODO: Implement symlink creation
    // 1. Check if target exists
    // 2. If exists and replaceExisting: Remove it
    // 3. If exists and not replaceExisting: Throw error
    // 4. Calculate link path (relative or absolute)
    // 5. Create symlink with fs.symlink
    // 6. Track operation in transaction
    // 7. Handle errors (permissions, invalid paths)

    throw new Error('Not implemented')
  }

  /**
   * Create multiple symlinks from patterns
   */
  createSymlinks(
    _sourceDir: string,
    _targetDir: string,
    _config: SymlinkConfig,
    _options: {
      replaceExisting?: boolean
      skipConflicts?: boolean
    } = {}
  ): Promise<SymlinkResult> {
    // TODO: Implement batch symlink creation
    // 1. Match files against config.patterns
    // 2. Build list of (source, target) pairs
    // 3. Detect conflicts
    // 4. If conflicts and not skipConflicts: Throw SymlinkConflictError
    // 5. Create all symlinks
    // 6. Track each operation
    // 7. Return result with counts and any skipped files

    throw new Error('Not implemented')
  }

  /**
   * Verify a symlink points to the correct target
   */
  verifySymlink(_linkPath: string, _expectedTarget: string): Promise<boolean> {
    // TODO: Implement symlink verification
    // 1. Check if linkPath is a symlink
    // 2. Read link target
    // 3. Compare with expectedTarget (resolve relative paths)
    // 4. Return true if matches, false otherwise

    throw new Error('Not implemented')
  }
}

/**
 * Result of symlink operations
 */
export interface SymlinkResult {
  success: boolean
  created: number
  skipped: number
  conflicts: Array<{ source: string; target: string; reason: string }>
}

// ============================================================================
// Helper Factories
// ============================================================================

/**
 * Create RsyncHelper with transaction
 */
export function createRsyncHelper(transaction: FileOperationTransaction): RsyncHelper {
  return new RsyncHelper(transaction)
}

/**
 * Create SymlinkHelper with transaction
 */
export function createSymlinkHelper(transaction: FileOperationTransaction): SymlinkHelper {
  return new SymlinkHelper(transaction)
}
