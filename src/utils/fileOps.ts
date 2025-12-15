import fs from 'fs-extra'
import { symlink as fsSymlink, readlink as fsReadlink, lstat as fsLstat } from 'fs/promises'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { globby } from 'globby'
import * as path from 'path'
import * as os from 'os'
import type { RsyncConfig, SymlinkConfig } from '../config/schema.js'
import type { RsyncProgressCallback } from './rsyncProgress.js'

const execAsync = promisify(exec)

/**
 * File Operations Utilities
 *
 * Handles rsync and symlink operations with transaction support
 * for rollback capabilities.
 */

/**
 * Error with additional properties from exec/filesystem operations
 */
interface ExecError extends Error {
  stderr?: string
  stdout?: string
  code?: string | number
}

/**
 * Get error code from an error object
 */
function getErrorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    return String((error as ExecError).code)
  }
  return 'UNKNOWN'
}

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
 * Result of a rollback operation
 */
export interface RollbackResult {
  /** Operations that were successfully rolled back */
  rolledBackOperations: Operation[]
  /** Operations that failed to rollback */
  failedRollbacks: Array<{ operation: Operation; error: string }>
  /** Checkpoint data preserved from before rollback */
  checkpoints: Map<string, unknown>
}

/**
 * Transaction for tracking file operations
 *
 * Enables rollback of all operations if any step fails.
 */
export class FileOperationTransaction {
  private operations: Operation[] = []
  private checkpoints: Map<string, unknown> = new Map()
  private onWarning?: (message: string) => void

  /**
   * Create a transaction with optional warning callback
   * @param onWarning - Callback for warning messages during rollback
   */
  constructor(onWarning?: (message: string) => void) {
    this.onWarning = onWarning
  }

  /**
   * Record an operation
   */
  record(type: OperationType, path: string, metadata?: Record<string, unknown>): void {
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
  createCheckpoint(name: string, data: unknown): void {
    this.checkpoints.set(name, data)
  }

  /**
   * Get a checkpoint by name
   */
  getCheckpoint(name: string): unknown {
    return this.checkpoints.get(name)
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
  async rollback(): Promise<RollbackResult> {
    // Preserve checkpoints BEFORE clearing - critical for post-rollback use
    const preservedCheckpoints = new Map(this.checkpoints)
    const rolledBackOperations: Operation[] = []
    const failedRollbacks: Array<{ operation: Operation; error: string }> = []

    // Iterate operations in reverse order
    const reversedOps = [...this.operations].reverse()

    for (const op of reversedOps) {
      try {
        switch (op.type) {
          case OperationType.CREATE_SYMLINK:
            // Remove symlink if it exists
            if (await fs.pathExists(op.path)) {
              const stats = await fsLstat(op.path)
              if (stats.isSymbolicLink()) {
                await fs.unlink(op.path)
                rolledBackOperations.push(op)
              } else {
                // Path exists but is not a symlink - skip with warning
                this.onWarning?.(
                  `Skipped rollback of ${op.type} at ${op.path}: path exists but is not a symlink`
                )
              }
            }
            // If path doesn't exist, nothing to rollback (already cleaned up)
            break

          case OperationType.RSYNC:
            // For rsync, we need to remove the destination
            // This is tricky - we can only remove if we have metadata about what was created
            if (op.metadata?.destination) {
              const dest = op.metadata.destination as string
              if (await fs.pathExists(dest)) {
                await fs.remove(dest)
                rolledBackOperations.push(op)
              }
              // If destination doesn't exist, nothing to rollback
            } else {
              // No destination metadata - cannot rollback
              this.onWarning?.(
                `Skipped rollback of ${op.type} at ${op.path}: no destination metadata recorded`
              )
            }
            break

          case OperationType.CREATE_DIR:
            // Remove directory if it exists and is empty
            if (await fs.pathExists(op.path)) {
              try {
                const items = await fs.readdir(op.path)
                if (items.length === 0) {
                  await fs.remove(op.path)
                  rolledBackOperations.push(op)
                } else {
                  // Directory not empty - skip with warning
                  this.onWarning?.(
                    `Skipped rollback of ${op.type} at ${op.path}: directory not empty (${items.length} items)`
                  )
                }
              } catch (dirError) {
                // Error reading directory - report and continue
                const dirErrMsg = dirError instanceof Error ? dirError.message : String(dirError)
                this.onWarning?.(
                  `Skipped rollback of ${op.type} at ${op.path}: failed to read directory: ${dirErrMsg}`
                )
              }
            }
            break

          case OperationType.DELETE_FILE:
            // Restore from preserved checkpoint if available
            const checkpointKey = `file:${op.path}`
            if (preservedCheckpoints.has(checkpointKey)) {
              const content = preservedCheckpoints.get(checkpointKey) as string
              await fs.writeFile(op.path, content)
              rolledBackOperations.push(op)
            } else {
              // No checkpoint for file restoration - skip with warning
              this.onWarning?.(
                `Skipped rollback of ${op.type} at ${op.path}: no checkpoint backup available`
              )
            }
            break
        }
      } catch (error) {
        // Report error but continue rolling back other operations
        const errMsg = error instanceof Error ? error.message : String(error)
        failedRollbacks.push({ operation: op, error: errMsg })
        this.onWarning?.(`Failed to rollback operation ${op.type} at ${op.path}: ${errMsg}`)
      }
    }

    // Clear operations and checkpoints after rollback
    this.clear()

    return {
      rolledBackOperations,
      failedRollbacks,
      checkpoints: preservedCheckpoints,
    }
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
/**
 * Rsync version and capability information
 */
export interface RsyncVersionInfo {
  /** Whether rsync is installed */
  installed: boolean
  /** Version string (e.g., "3.2.7") */
  version?: string
  /** Major version number */
  major?: number
  /** Minor version number */
  minor?: number
  /** Whether --progress flag is supported (rsync 2.6.0+) */
  supportsProgress: boolean
  /** Whether --stats flag is supported (rsync 2.6.0+) */
  supportsStats: boolean
}

export class RsyncHelper {
  private versionCache?: RsyncVersionInfo

  constructor(private _transaction: FileOperationTransaction) {}

  /**
   * Check if rsync is installed and available
   */
  async isInstalled(): Promise<boolean> {
    const info = await this.getVersionInfo()
    return info.installed
  }

  /**
   * Get rsync version and capability information
   *
   * Results are cached for the lifetime of this helper instance.
   * The --progress and --stats flags require rsync 2.6.0 or later.
   */
  async getVersionInfo(): Promise<RsyncVersionInfo> {
    // Return cached result if available
    if (this.versionCache) {
      return this.versionCache
    }

    try {
      const { stdout } = await execAsync('rsync --version')

      // Parse version from output like "rsync  version 3.2.7  protocol version 31"
      const versionMatch = stdout.match(/rsync\s+version\s+(\d+)\.(\d+)\.?(\d+)?/i)

      if (versionMatch && versionMatch[1] && versionMatch[2]) {
        const major = parseInt(versionMatch[1], 10)
        const minor = parseInt(versionMatch[2], 10)
        const patch = versionMatch[3] ? parseInt(versionMatch[3], 10) : 0

        // --progress and --stats are available since rsync 2.6.0
        const supportsModernFlags = major > 2 || (major === 2 && minor >= 6)

        this.versionCache = {
          installed: true,
          version: `${major}.${minor}.${patch}`,
          major,
          minor,
          supportsProgress: supportsModernFlags,
          supportsStats: supportsModernFlags,
        }
      } else {
        // Rsync installed but couldn't parse version - assume modern features supported
        this.versionCache = {
          installed: true,
          supportsProgress: true,
          supportsStats: true,
        }
      }
    } catch {
      this.versionCache = {
        installed: false,
        supportsProgress: false,
        supportsStats: false,
      }
    }

    return this.versionCache
  }

  /**
   * Flags that are managed internally and should be filtered from user config
   */
  private static readonly INTERNAL_FLAGS = ['--stats', '--progress', '--dry-run']

  /**
   * Escape a string for safe use in shell commands
   * Uses single quotes which prevent all shell expansion
   *
   * @param str - String to escape
   * @returns Shell-safe escaped string
   */
  private shellEscape(str: string): string {
    // Single quotes prevent all shell expansion
    // To include a single quote, we end the quoted string, add an escaped single quote, and restart
    return `'${str.replace(/'/g, "'\\''")}'`
  }

  /**
   * Validate and sanitize rsync flags
   * Removes internally-managed flags to prevent conflicts
   *
   * @param flags - User-provided flags
   * @returns Sanitized flags array
   */
  private sanitizeFlags(flags: string[]): string[] {
    return flags.filter((flag) => {
      // Skip empty or whitespace-only flags
      if (!flag || !flag.trim()) {
        return false
      }

      // Filter out flags we manage internally
      const normalizedFlag = flag.trim().toLowerCase()
      for (const internal of RsyncHelper.INTERNAL_FLAGS) {
        if (normalizedFlag === internal || normalizedFlag.startsWith(`${internal}=`)) {
          return false
        }
      }

      return true
    })
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

    // Add flags from config (sanitized to remove internally-managed flags)
    if (config.flags && config.flags.length > 0) {
      const sanitizedFlags = this.sanitizeFlags(config.flags)
      parts.push(...sanitizedFlags)
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

    // SAFETY: Always exclude .git directory to prevent worktree corruption
    // Each worktree has its own .git file that points to the main repository's
    // .git/worktrees/<name> directory. Syncing .git content between worktrees
    // would break git's worktree tracking and corrupt repository state.
    // This exclusion is intentionally non-configurable for safety.
    if (!excludes.includes('.git')) {
      excludes.push('.git')
    }

    // Add exclude flags (shell-escaped to prevent expansion)
    for (const pattern of excludes) {
      parts.push('--exclude', this.shellEscape(pattern))
    }

    // Add source and destination (shell-escaped)
    // IMPORTANT: Source needs trailing slash to copy contents, not the directory itself
    // Without trailing slash: rsync /src/dir /dest → /dest/dir/...
    // With trailing slash: rsync /src/dir/ /dest → /dest/...
    const sourceWithSlash = source.endsWith('/') ? source : `${source}/`
    parts.push(this.shellEscape(sourceWithSlash), this.shellEscape(destination))

    return parts.join(' ')
  }

  /**
   * Build rsync command arguments array for spawn
   * Unlike buildCommand(), this returns an array suitable for child_process.spawn
   */
  buildArgs(
    source: string,
    destination: string,
    config: RsyncConfig,
    additionalExcludes: string[] = [],
    internalFlags: string[] = []
  ): string[] {
    const args: string[] = []

    // Add flags from config (sanitized to remove internally-managed flags from user config)
    if (config.flags && config.flags.length > 0) {
      const sanitizedFlags = this.sanitizeFlags(config.flags)
      args.push(...sanitizedFlags)
    }

    // Add internal flags (--stats, --progress) that are managed by the code
    // These are added AFTER sanitization to ensure they're always included
    args.push(...internalFlags)

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

    // SAFETY: Always exclude .git directory (see buildCommand for rationale)
    if (!excludes.includes('.git')) {
      excludes.push('.git')
    }

    // Add exclude flags (no quotes needed for spawn)
    for (const pattern of excludes) {
      args.push('--exclude', pattern)
    }

    // Add source and destination (no quotes needed for spawn)
    const sourceWithSlash = source.endsWith('/') ? source : `${source}/`
    args.push(sourceWithSlash, destination)

    return args
  }

  /**
   * Parse rsync progress output line to detect file transfers
   * Returns flags for file completion (xfer#N pattern) and filename detection
   */
  parseProgressLine(line: string): { isFileComplete: boolean; isFileName: boolean } {
    // Rsync --progress output format for completed file:
    // 14.71M 100% 237.69MB/s 0:00:00 (xfer#1, to-check=1/2)
    // The (xfer#N) pattern indicates Nth file transfer completed
    if (line.match(/\(xfer#\d+/)) {
      return { isFileComplete: true, isFileName: false }
    }

    // Detect filename lines - rsync outputs each filename being synced
    // Skip status/stats lines to only count actual file transfers
    const trimmed = line.trim()
    if (
      trimmed &&
      !trimmed.startsWith('sending ') &&
      !trimmed.startsWith('total ') &&
      !trimmed.startsWith('Number of ') &&
      !trimmed.match(/^\d+.*%/) && // Skip progress percentage lines
      !trimmed.match(/^sent \d+/) &&
      !trimmed.match(/^received \d+/)
    ) {
      return { isFileComplete: false, isFileName: true }
    }

    return { isFileComplete: false, isFileName: false }
  }

  /**
   * Execute rsync from source to destination
   *
   * @param source - Source directory
   * @param destination - Destination directory
   * @param config - Rsync configuration
   * @param options - Options including exclude patterns and progress callbacks
   * @param options.excludePatterns - Additional patterns to exclude
   * @param options.totalFiles - Pre-estimated file count for progress percentage
   * @param options.onProgress - Callback for real-time progress updates
   */
  async rsync(
    source: string,
    destination: string,
    config: RsyncConfig,
    options: {
      excludePatterns?: string[]
      totalFiles?: number
      onProgress?: RsyncProgressCallback
    } = {}
  ): Promise<RsyncResult> {
    // Check if rsync is installed and get version info
    const versionInfo = await this.getVersionInfo()
    if (!versionInfo.installed) {
      throw new RsyncNotInstalledError()
    }

    // Build internal flags for --stats and --progress (real-time output)
    // These flags require rsync 2.6.0+ (released 2004), but we check just in case
    const internalFlags: string[] = []
    if (versionInfo.supportsStats) {
      internalFlags.push('--stats')
    }
    if (versionInfo.supportsProgress) {
      internalFlags.push('--progress')
    }

    // Build args array for spawn
    // Pass internal flags separately so they aren't filtered by sanitizeFlags
    const args = this.buildArgs(
      source,
      destination,
      config,
      options.excludePatterns || [],
      internalFlags
    )

    // Record start time
    const startTime = Date.now()

    return new Promise((resolve, reject) => {
      const rsyncProcess = spawn('rsync', args)
      let stdout = ''
      let stderr = ''
      let filesTransferred = 0
      let lastProgressUpdate = 0
      const throttleMs = 100

      rsyncProcess.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stdout += chunk

        // Parse for progress if callback provided
        if (options.onProgress) {
          const lines = chunk.split('\n')
          for (const line of lines) {
            const parsed = this.parseProgressLine(line)

            // Count files from filename lines (rsync outputs each file being processed)
            if (parsed.isFileName) {
              filesTransferred++
            }
            // If xfer# pattern detected, use exact count (authoritative)
            if (parsed.isFileComplete) {
              const match = line.match(/\(xfer#(\d+)/)
              if (match && match[1]) {
                filesTransferred = parseInt(match[1], 10)
              }
            }

            // Throttle updates to avoid flickering
            if (parsed.isFileName || parsed.isFileComplete) {
              const now = Date.now()
              if (now - lastProgressUpdate >= throttleMs) {
                lastProgressUpdate = now
                const totalFiles = options.totalFiles || 0
                options.onProgress({
                  filesTransferred,
                  totalFiles,
                  // Use one decimal place for more accurate progress representation
                  percentage:
                    totalFiles > 0
                      ? Math.round((filesTransferred / totalFiles) * 1000) / 10
                      : undefined,
                })
              }
            }
          }
        }
      })

      rsyncProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      rsyncProcess.on('close', (code) => {
        // Send final progress update (in case last update was throttled)
        if (options.onProgress && filesTransferred > 0) {
          const totalFiles = options.totalFiles || 0
          options.onProgress({
            filesTransferred,
            totalFiles,
            // Final update: use one decimal place for consistency
            percentage:
              totalFiles > 0 ? Math.round((filesTransferred / totalFiles) * 1000) / 10 : undefined,
          })
        }

        if (code !== 0) {
          reject(new FileOperationError(`rsync command failed with code ${code}: ${stderr}`))
          return
        }

        // Track operation in transaction
        this._transaction.record(OperationType.RSYNC, destination, {
          source,
          destination,
        })

        // Parse output for statistics
        const result = this.parseRsyncStats(stdout + stderr, Date.now() - startTime)
        resolve(result)
      })

      rsyncProcess.on('error', (error) => {
        reject(new FileOperationError(`rsync failed: ${error.message}`, error))
      })
    })
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

    // Handle rsync 3.x output format: "Number of created files: 1 (reg: 1)"
    // or older format: "Number of created files: 1"
    const filesMatch = output.match(/Number of created files:\s*([\d,]+)/)
    if (filesMatch && filesMatch[1]) {
      result.filesTransferred = parseInt(filesMatch[1].replace(/,/g, ''), 10)
    }

    const sentMatch = output.match(/sent ([\d,]+) bytes/)
    if (sentMatch && sentMatch[1]) {
      result.bytesSent = parseInt(sentMatch[1].replace(/,/g, ''), 10)
    }

    // Handle rsync 3.x output format with or without commas
    // "Total file size: 2,097,152 bytes" or "Total file size: 13 bytes"
    const totalSizeMatch = output.match(/Total file size:\s*([\d,]+)\s*bytes/)
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
    // Include process ID and timestamp for uniqueness to avoid conflicts
    // when multiple processes run concurrently
    const uniqueId = `${process.pid}-${Date.now()}`
    const tempDest = path.join(os.tmpdir(), `pando-rsync-estimate-${uniqueId}`)
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
   * Match files and directories against glob patterns
   *
   * This method matches files and directories in baseDir against the provided glob patterns.
   * It automatically deduplicates results so that if a directory is matched, files inside
   * that directory are not also returned (since symlinking the directory covers them).
   *
   * @param baseDir - The base directory to search in
   * @param patterns - Array of glob patterns (e.g., ['*.txt', 'node_modules', '.env'])
   * @returns Array of matched relative paths (deduplicated)
   *
   * @example
   * // Match all .txt files and the node_modules directory
   * const matches = await symlinkHelper.matchPatterns('/project', ['*.txt', 'node_modules'])
   * // Returns: ['file.txt', 'node_modules'] (files inside node_modules are NOT included)
   */
  async matchPatterns(baseDir: string, patterns: string[]): Promise<string[]> {
    try {
      // Match files with patterns
      const fileMatches = await globby(patterns, {
        cwd: baseDir,
        onlyFiles: true,
        dot: true,
      })

      // Match directories with glob patterns (for patterns like "subdir*" or "*")
      const globDirMatches = await globby(patterns, {
        cwd: baseDir,
        onlyDirectories: true,
        dot: true,
      })

      // Also check if any non-glob pattern directly matches an existing directory
      // (globby doesn't match directories by exact name like "subdir" without wildcards)
      const directDirMatches: string[] = []
      for (const pattern of patterns) {
        // Skip glob patterns - they're handled above
        if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
          continue
        }
        // Check if pattern matches an existing directory
        const normalizedPattern = pattern.replace(/\/$/, '') // Remove trailing slash if present
        const dirPath = path.join(baseDir, normalizedPattern)
        try {
          const stats = await fs.stat(dirPath)
          if (stats.isDirectory()) {
            directDirMatches.push(normalizedPattern)
          }
        } catch {
          // Directory doesn't exist, skip
        }
      }

      // Combine and deduplicate
      const allMatches = [...new Set([...fileMatches, ...globDirMatches, ...directDirMatches])]

      // Deduplicate: remove files that are inside a matched directory
      // (if both .cursor/ and .cursor/file.md match, only keep .cursor/)
      return this.deduplicateMatches(allMatches, baseDir)
    } catch (error) {
      throw new FileOperationError('Failed to match patterns', error as Error)
    }
  }

  /**
   * Remove files/directories that are inside a matched directory.
   *
   * When both a directory and items inside it match the patterns, only keep the
   * top-level directory. This prevents redundant symlink operations since
   * symlinking a directory already covers all its contents.
   *
   * @param matches - Array of matched relative paths
   * @param baseDir - Base directory for resolving paths
   * @returns Filtered array with nested items removed
   *
   * @example
   * // Input: ['parent', 'parent/child', 'parent/child/file.txt', 'standalone.txt']
   * // Output: ['parent', 'standalone.txt']
   * // Reason: parent/child and parent/child/file.txt are inside 'parent'
   */
  private async deduplicateMatches(matches: string[], baseDir: string): Promise<string[]> {
    // Early return for empty or single-item arrays (no deduplication needed)
    if (matches.length <= 1) {
      return matches
    }

    // Identify which matches are directories
    const directories = new Set<string>()
    for (const match of matches) {
      const fullPath = path.join(baseDir, match)
      try {
        const stats = await fs.stat(fullPath)
        if (stats.isDirectory()) {
          directories.add(match)
        }
      } catch {
        // File doesn't exist or can't be accessed, skip
        // This is expected for broken symlinks or permission issues
      }
    }

    // Filter out items (files or directories) that are inside a matched directory
    return matches.filter((match) => {
      // Check if any parent path is in the directories set
      // This applies to both files AND nested directories
      let parentPath = path.dirname(match)
      while (parentPath !== '.' && parentPath !== '') {
        if (directories.has(parentPath)) {
          // Skip - this item is inside a matched directory
          // The parent directory symlink will cover this item
          return false
        }
        parentPath = path.dirname(parentPath)
      }
      return true
    })
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
          const stats = await fsLstat(link.target)

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
          const stats = await fsLstat(target)
          if (stats.isSymbolicLink() || stats.isFile()) {
            await fs.unlink(target)
          } else if (stats.isDirectory()) {
            await fs.remove(target)
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
      const errCode = getErrorCode(error)
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
