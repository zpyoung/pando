import * as fs from 'fs-extra'
import { symlink as fsSymlink, readlink as fsReadlink, lstat as fsLstat } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { globby } from 'globby'
import * as path from 'path'
import type { RsyncConfig, SymlinkConfig } from '../config/schema.js'

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
              const content = this.checkpoints.get(checkpointKey) as string
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
  constructor(private _transaction: FileOperationTransaction) {}

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
    source: string,
    destination: string,
    config: RsyncConfig,
    additionalExcludes: string[] = []
  ): string {
    const parts: string[] = ['rsync']

    // Add flags from config
    if (config.flags && config.flags.length > 0) {
      parts.push(...config.flags)
    }

    // Collect all exclude patterns
    const excludes: string[] = []

    // Add excludes from config
    if (config.exclude && config.exclude.length > 0) {
      excludes.push(...config.exclude)
    }

    // Add additional excludes
    if (additionalExcludes.length > 0) {
      excludes.push(...additionalExcludes)
    }

    // Always exclude .git directory
    if (!excludes.includes('.git')) {
      excludes.push('.git')
    }

    // Add exclude flags
    for (const pattern of excludes) {
      parts.push('--exclude', `"${pattern}"`)
    }

    // Add source and destination (quote them)
    parts.push(`"${source}"`, `"${destination}"`)

    return parts.join(' ')
  }

  /**
   * Execute rsync from source to destination
   */
  async rsync(
    source: string,
    destination: string,
    config: RsyncConfig,
    options: {
      excludePatterns?: string[]
      onProgress?: (output: string) => void
    } = {}
  ): Promise<RsyncResult> {
    // Check if rsync is installed
    if (!(await this.isInstalled())) {
      throw new RsyncNotInstalledError()
    }

    // Build rsync command (add --stats for statistics)
    const configWithStats: RsyncConfig = {
      ...config,
      flags: [...(config.flags || []), '--stats'],
    }
    const command = this.buildCommand(
      source,
      destination,
      configWithStats,
      options.excludePatterns || []
    )

    // Record start time
    const startTime = Date.now()

    try {
      // Execute command
      const { stdout, stderr } = await execAsync(command)

      // Call progress callback if provided
      if (options.onProgress) {
        options.onProgress(stdout)
      }

      // Track operation in transaction
      this._transaction.record(OperationType.RSYNC, destination, {
        source,
        destination,
        command,
      })

      // Parse output for statistics
      const result = this.parseRsyncStats(stdout + stderr, Date.now() - startTime)

      return result
    } catch (error) {
      throw new FileOperationError('rsync command failed', error as Error)
    }
  }

  /**
   * Parse rsync statistics from output
   */
  private parseRsyncStats(output: string, duration: number): RsyncResult {
    const result: RsyncResult = {
      success: true,
      filesTransferred: 0,
      bytesSent: 0,
      totalSize: 0,
      duration,
    }

    // Parse statistics from rsync output
    // Example output:
    // Number of files: 123 (reg: 100, dir: 23)
    // Number of created files: 50
    // Total file size: 1,234,567 bytes
    // Total transferred file size: 1,000,000 bytes
    // sent 1,234,567 bytes  received 890 bytes  2,470,914.00 bytes/sec

    const filesMatch = output.match(/Number of created files: (\d+)/)
    if (filesMatch && filesMatch[1]) {
      result.filesTransferred = parseInt(filesMatch[1], 10)
    }

    const sentMatch = output.match(/sent ([\d,]+) bytes/)
    if (sentMatch && sentMatch[1]) {
      result.bytesSent = parseInt(sentMatch[1].replace(/,/g, ''), 10)
    }

    const totalSizeMatch = output.match(/Total file size: ([\d,]+) bytes/)
    if (totalSizeMatch && totalSizeMatch[1]) {
      result.totalSize = parseInt(totalSizeMatch[1].replace(/,/g, ''), 10)
    }

    return result
  }

  /**
   * Get estimated file count for rsync
   */
  async estimateFileCount(source: string, config: RsyncConfig): Promise<number> {
    // Run rsync with --dry-run and --stats to get file count
    const dryRunConfig: RsyncConfig = {
      ...config,
      flags: [...(config.flags || []), '--dry-run', '--stats'],
    }

    // Use a temporary destination that won't be created (dry-run)
    const tempDest = '/tmp/pando-rsync-estimate'
    const command = this.buildCommand(source, tempDest, dryRunConfig)

    try {
      const { stdout, stderr } = await execAsync(command)
      const output = stdout + stderr

      // Parse file count from output
      // Look for "Number of files: X" or "Number of regular files transferred: X"
      const filesMatch = output.match(/Number of (?:regular )?files(?: transferred)?: (\d+)/)
      if (filesMatch && filesMatch[1]) {
        return parseInt(filesMatch[1], 10)
      }

      // Fallback: count lines that look like file transfers
      const lines = output.split('\n').filter((line) => line.trim() && !line.startsWith('sending'))
      return lines.length
    } catch {
      // If estimation fails, return 0 (caller can handle gracefully)
      return 0
    }
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
  constructor(private _transaction: FileOperationTransaction) {}

  /**
   * Match files against glob patterns
   */
  async matchPatterns(baseDir: string, patterns: string[]): Promise<string[]> {
    try {
      // Use globby to match patterns in baseDir
      const matches = await globby(patterns, {
        cwd: baseDir,
        onlyFiles: true, // Filter out directories
        dot: true, // Include dotfiles
      })

      return matches
    } catch (error) {
      throw new FileOperationError('Failed to match patterns', error as Error)
    }
  }

  /**
   * Detect conflicts (files that exist at target path)
   */
  async detectConflicts(
    links: Array<{ source: string; target: string }>
  ): Promise<Array<{ source: string; target: string; reason: string }>> {
    const conflicts: Array<{ source: string; target: string; reason: string }> = []

    for (const link of links) {
      try {
        // Check if target exists
        if (await fs.pathExists(link.target)) {
          const stats = await fs.lstat(link.target)

          let reason: string
          if (stats.isSymbolicLink()) {
            reason = 'symlink already exists'
          } else if (stats.isDirectory()) {
            reason = 'directory exists at target'
          } else if (stats.isFile()) {
            reason = 'file exists at target'
          } else {
            reason = 'unknown item exists at target'
          }

          conflicts.push({
            source: link.source,
            target: link.target,
            reason,
          })
        }
      } catch {
        // If we can't check, treat it as no conflict (will fail during creation if needed)
        continue
      }
    }

    return conflicts
  }

  /**
   * Create a single symlink
   */
  async createSymlink(
    source: string,
    target: string,
    options: {
      relative?: boolean
      replaceExisting?: boolean
    } = {}
  ): Promise<void> {
    try {
      // Check if target exists
      if (await fs.pathExists(target)) {
        if (options.replaceExisting) {
          // Remove existing target
          const stats = await fs.lstat(target)
          if (stats.isSymbolicLink() || stats.isFile()) {
            await fs.unlink(target)
          } else if (stats.isDirectory()) {
            await fs.rmdir(target)
          }
        } else {
          throw new FileOperationError(`Target already exists: ${target}`)
        }
      }

      // Ensure parent directory exists
      const targetDir = path.dirname(target)
      await fs.ensureDir(targetDir)

      // Calculate link path (relative or absolute)
      let linkPath: string
      if (options.relative) {
        // Calculate relative path from target to source
        linkPath = path.relative(targetDir, source)
      } else {
        // Use absolute path
        linkPath = path.resolve(source)
      }

      // Create symlink
      await fsSymlink(linkPath, target)

      // Track operation in transaction
      this._transaction.record(OperationType.CREATE_SYMLINK, target, {
        source,
        target: source, // Store source as target for verification
        linkPath,
      })
    } catch (error) {
      if (error instanceof FileOperationError) {
        throw error
      }
      const errMsg = error instanceof Error ? error.message : String(error)
      const errCode = (error as any).code || 'UNKNOWN'
      throw new FileOperationError(
        `Failed to create symlink from ${source} to ${target}: ${errMsg} (${errCode})`,
        error as Error
      )
    }
  }

  /**
   * Create multiple symlinks from patterns
   */
  async createSymlinks(
    sourceDir: string,
    targetDir: string,
    config: SymlinkConfig,
    options: {
      replaceExisting?: boolean
      skipConflicts?: boolean
    } = {}
  ): Promise<SymlinkResult> {
    const result: SymlinkResult = {
      success: true,
      created: 0,
      skipped: 0,
      conflicts: [],
    }

    try {
      // Match files against config.patterns
      const matches = await this.matchPatterns(sourceDir, config.patterns)

      // Build list of (source, target) pairs
      const links: Array<{ source: string; target: string }> = matches.map((relativePath) => ({
        source: path.join(sourceDir, relativePath),
        target: path.join(targetDir, relativePath),
      }))

      // Detect conflicts
      const conflicts = await this.detectConflicts(links)
      result.conflicts = conflicts

      // If conflicts exist and not skipConflicts: Throw error
      if (conflicts.length > 0 && !options.skipConflicts) {
        throw new SymlinkConflictError(
          `Found ${conflicts.length} conflict(s). Use skipConflicts option to skip them.`,
          conflicts
        )
      }

      // Create set of conflicting targets for easy lookup
      const conflictTargets = new Set(conflicts.map((c) => c.target))

      // Create all symlinks (skip conflicts if skipConflicts is true)
      for (const link of links) {
        if (conflictTargets.has(link.target) && options.skipConflicts) {
          // Skip this link due to conflict
          result.skipped++
          continue
        }

        try {
          await this.createSymlink(link.source, link.target, {
            relative: config.relative,
            replaceExisting: options.replaceExisting,
          })
          result.created++
        } catch (error) {
          // If individual symlink fails, track as conflict
          result.conflicts.push({
            source: link.source,
            target: link.target,
            reason: error instanceof Error ? error.message : 'unknown error',
          })
          result.skipped++
        }
      }

      return result
    } catch (error) {
      result.success = false
      if (error instanceof SymlinkConflictError) {
        throw error
      }
      throw new FileOperationError('Failed to create symlinks', error as Error)
    }
  }

  /**
   * Verify a symlink points to the correct target
   */
  async verifySymlink(linkPath: string, expectedTarget: string): Promise<boolean> {
    try {
      // Check if linkPath exists and is a symlink
      if (!(await fs.pathExists(linkPath))) {
        return false
      }

      const stats = await fsLstat(linkPath)
      if (!stats.isSymbolicLink()) {
        return false
      }

      // Read the actual target of the symlink
      const actualTarget = await fsReadlink(linkPath)

      // Resolve both paths for comparison
      const linkDir = path.dirname(linkPath)
      const resolvedActual = path.resolve(linkDir, actualTarget)
      const resolvedExpected = path.resolve(linkDir, expectedTarget)

      return resolvedActual === resolvedExpected
    } catch {
      // If we can't verify, return false
      return false
    }
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
