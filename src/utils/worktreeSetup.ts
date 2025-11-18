import type { PandoConfig, RsyncConfig, SymlinkConfig } from '../config/schema.js'
import type { GitHelper } from './git.js'
import {
  createRsyncHelper,
  createSymlinkHelper,
  FileOperationTransaction,
  RsyncHelper,
  SymlinkHelper,
  type Operation,
  type RsyncResult,
  type SymlinkResult,
} from './fileOps.js'

/**
 * Worktree Setup Orchestrator
 *
 * Orchestrates post-worktree-creation setup with rsync and symlink operations.
 * Provides transactional guarantees - rolls back on any failure.
 */

// ============================================================================
// Setup Options
// ============================================================================

/**
 * Options for worktree setup
 */
export interface SetupOptions {
  /**
   * Override rsync configuration
   */
  rsyncOverride?: Partial<RsyncConfig>

  /**
   * Override symlink configuration
   */
  symlinkOverride?: Partial<SymlinkConfig>

  /**
   * Skip rsync operation entirely
   */
  skipRsync?: boolean

  /**
   * Skip symlink operation entirely
   */
  skipSymlink?: boolean

  /**
   * Progress callback for long operations
   */
  onProgress?: (phase: SetupPhase, message: string) => void
}

/**
 * Setup phases for progress tracking
 */
export enum SetupPhase {
  INIT = 'init',
  CHECKPOINT = 'checkpoint',
  SYMLINK_BEFORE = 'symlink_before',
  RSYNC = 'rsync',
  SYMLINK_AFTER = 'symlink_after',
  VALIDATION = 'validation',
  COMPLETE = 'complete',
  ROLLBACK = 'rollback',
}

/**
 * Result of setup operation
 */
export interface SetupResult {
  success: boolean
  rsyncResult?: RsyncResult
  symlinkResult?: SymlinkResult
  duration: number
  warnings: string[]
  rolledBack: boolean
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Worktree setup orchestrator
 *
 * Coordinates the complex workflow of setting up a new worktree:
 * 1. Create checkpoint for rollback
 * 2. Create symlinks (if beforeRsync)
 * 3. Execute rsync
 * 4. Create symlinks (if !beforeRsync)
 * 5. Validate results
 * 6. On error: Rollback everything
 */
export class WorktreeSetupOrchestrator {
  private rsyncHelper: RsyncHelper
  private symlinkHelper: SymlinkHelper
  private transaction: FileOperationTransaction

  constructor(
    private gitHelper: GitHelper,
    private config: PandoConfig
  ) {
    this.transaction = new FileOperationTransaction()

    this.rsyncHelper = createRsyncHelper(this.transaction)
    this.symlinkHelper = createSymlinkHelper(this.transaction)
  }

  /**
   * Execute post-worktree-creation setup
   *
   * @param worktreePath - Path to the newly created worktree
   * @param options - Setup options and overrides
   * @returns Setup result with statistics
   */
  async setupNewWorktree(worktreePath: string, options: SetupOptions = {}): Promise<SetupResult> {
    const startTime = Date.now()
    const warnings: string[] = []
    let rsyncResult: RsyncResult | undefined
    let symlinkResult: SymlinkResult | undefined
    let rolledBack = false

    // Initialize results to undefined to avoid type inference issues with stub methods
    rsyncResult = undefined
    symlinkResult = undefined

    try {
      // ============================================================
      // Phase 1: Initialization
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.INIT, 'Initializing setup')

      // Merge configuration with overrides
      const rsyncConfig: RsyncConfig = {
        ...this.config.rsync,
        ...options.rsyncOverride,
        exclude: [...(this.config.rsync.exclude || []), ...(options.rsyncOverride?.exclude || [])],
      }

      const symlinkConfig: SymlinkConfig = {
        ...this.config.symlink,
        ...options.symlinkOverride,
        patterns: [
          ...(this.config.symlink.patterns || []),
          ...(options.symlinkOverride?.patterns || []),
        ],
      }

      // Get source tree path (main worktree)
      const sourceTreePath = await this.gitHelper.getMainWorktreePath()

      // Validate paths exist
      const fs = await import('fs-extra')
      if (!(await fs.pathExists(sourceTreePath))) {
        throw new Error(`Source tree path does not exist: ${sourceTreePath}`)
      }
      if (!(await fs.pathExists(worktreePath))) {
        throw new Error(`Worktree path does not exist: ${worktreePath}`)
      }

      // ============================================================
      // Phase 2: Create Checkpoint
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.CHECKPOINT, 'Creating checkpoint')

      // Create transaction checkpoint
      // Snapshot worktree state for potential rollback
      this.transaction.createCheckpoint('worktree', { path: worktreePath })

      // ============================================================
      // Phase 3: Symlinks (Before Rsync)
      // ============================================================
      if (!options.skipSymlink && this.config.symlink.beforeRsync) {
        this.reportProgress(
          options.onProgress,
          SetupPhase.SYMLINK_BEFORE,
          'Creating symlinks (before rsync)'
        )

        // Remove git-checked-out files that will be symlinked
        // Git automatically checks out tracked files when creating worktrees
        const filesToSymlink = await this.symlinkHelper.matchPatterns(
          sourceTreePath,
          symlinkConfig.patterns
        )
        for (const file of filesToSymlink) {
          const targetPath = await import('path').then((p) => p.default.join(worktreePath, file))
          if (await fs.pathExists(targetPath)) {
            await fs.remove(targetPath)
          }
        }

        // Create symlinks before rsync
        symlinkResult = await this.symlinkHelper.createSymlinks(
          sourceTreePath,
          worktreePath,
          symlinkConfig,
          {
            replaceExisting: true,
            skipConflicts: true,
          }
        )

        // Add warnings for skipped conflicts
        if (symlinkResult.conflicts.length > 0) {
          warnings.push(`Skipped ${symlinkResult.conflicts.length} symlink(s) due to conflicts`)
        }
      }

      // ============================================================
      // Phase 4: Rsync
      // ============================================================
      if (!options.skipRsync && this.config.rsync.enabled) {
        this.reportProgress(options.onProgress, SetupPhase.RSYNC, 'Copying files with rsync')

        // Check rsync is installed
        const { RsyncNotInstalledError } = await import('./fileOps.js')
        if (!(await this.rsyncHelper.isInstalled())) {
          throw new RsyncNotInstalledError()
        }

        // Build exclude patterns
        const excludePatterns: string[] = [
          '.git', // Always exclude .git
          ...rsyncConfig.exclude,
        ]

        // ALWAYS exclude files that will be symlinked (regardless of beforeRsync setting)
        // This prevents rsync from copying files that should be symlinks
        if (!options.skipSymlink && symlinkConfig.patterns.length > 0) {
          // Match symlink patterns against source directory to find files that will be symlinked
          const filesToSymlink = await this.symlinkHelper.matchPatterns(
            sourceTreePath,
            symlinkConfig.patterns
          )

          // Add matched files to rsync exclude patterns
          // Prepend '/' to match from root of source directory in rsync
          const symlinkExcludes = filesToSymlink.map((file) => `/${file}`)
          excludePatterns.push(...symlinkExcludes)
        }

        // Execute rsync
        rsyncResult = await this.rsyncHelper.rsync(sourceTreePath, worktreePath, rsyncConfig, {
          excludePatterns,
          onProgress: options.onProgress
            ? (output: string): void => options.onProgress!(SetupPhase.RSYNC, output)
            : undefined,
        })
      }

      // ============================================================
      // Phase 5: Symlinks (After Rsync)
      // ============================================================
      if (!options.skipSymlink && !this.config.symlink.beforeRsync) {
        this.reportProgress(
          options.onProgress,
          SetupPhase.SYMLINK_AFTER,
          'Creating symlinks (after rsync)'
        )

        // Remove git-checked-out files that will be symlinked
        // Git automatically checks out tracked files when creating worktrees
        const filesToSymlink = await this.symlinkHelper.matchPatterns(
          sourceTreePath,
          symlinkConfig.patterns
        )
        const path = await import('path')
        for (const file of filesToSymlink) {
          const targetPath = path.default.join(worktreePath, file)
          if (await fs.pathExists(targetPath)) {
            await fs.remove(targetPath)
          }
        }

        // Create symlinks after rsync
        // Rsync already excluded these files, so no conflicts expected
        symlinkResult = await this.symlinkHelper.createSymlinks(
          sourceTreePath,
          worktreePath,
          symlinkConfig,
          {
            replaceExisting: true,
            skipConflicts: true,
          }
        )

        // Add warnings for any conflicts (shouldn't happen since rsync excluded them)
        if (symlinkResult.conflicts.length > 0) {
          warnings.push(
            `Could not create ${symlinkResult.conflicts.length} symlink(s) due to conflicts`
          )
        }
      }

      // ============================================================
      // Phase 6: Validation
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.VALIDATION, 'Validating setup')

      // Check worktree still exists
      if (!(await fs.pathExists(worktreePath))) {
        warnings.push('Worktree path no longer exists after setup')
      }

      // Verify symlinks if any were created
      if (symlinkResult && symlinkResult.created > 0) {
        const { OperationType } = await import('./fileOps.js')
        const symlinkOps = this.transaction
          .getOperations()
          .filter((op: Operation) => op.type === OperationType.CREATE_SYMLINK)

        for (const op of symlinkOps) {
          const linkPath = op.path
          const expectedTarget = op.metadata?.target as string

          if (!(await this.symlinkHelper.verifySymlink(linkPath, expectedTarget))) {
            warnings.push(`Symlink verification failed: ${linkPath}`)
          }
        }
      }

      // Verify rsync completed if enabled
      if (rsyncResult && !rsyncResult.success) {
        warnings.push('Rsync reported unsuccessful completion')
      }

      // ============================================================
      // Phase 7: Complete
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.COMPLETE, 'Setup complete')

      const duration = Date.now() - startTime

      return {
        success: true,
        rsyncResult,
        symlinkResult,
        duration,
        warnings,
        rolledBack: false,
      }
    } catch (error) {
      // ============================================================
      // Error Handling: Rollback
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.ROLLBACK, 'Error occurred, rolling back')

      try {
        // TODO: Execute rollback
        // 1. Remove worktree (git worktree remove --force)
        // 2. Clean up symlinks
        // 3. Restore from checkpoint if needed
        // 4. Log rollback actions
        await this.transaction.rollback()
        rolledBack = true
      } catch (rollbackError) {
        // TODO: Handle rollback failure
        // Log error but don't throw
        // Add to warnings
        warnings.push(`Rollback partially failed: ${rollbackError}`)
      }

      const duration = Date.now() - startTime

      // Re-throw original error with context
      throw new SetupError(
        `Setup failed: ${error}`,
        {
          success: false,
          rsyncResult,
          symlinkResult,
          duration,
          warnings,
          rolledBack,
        },
        error as Error
      )
    }
  }

  /**
   * Report progress to callback
   */
  private reportProgress(
    callback: ((phase: SetupPhase, message: string) => void) | undefined,
    phase: SetupPhase,
    message: string
  ): void {
    if (callback) {
      callback(phase, message)
    }
  }

  /**
   * Get the transaction for advanced usage
   */
  getTransaction(): FileOperationTransaction {
    return this.transaction
  }
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown during setup with detailed context
 */
export class SetupError extends Error {
  constructor(
    message: string,
    public readonly result: SetupResult,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'SetupError'
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create worktree setup orchestrator
 *
 * @param gitHelper - Git helper instance
 * @param config - Pando configuration
 * @returns Orchestrator instance
 */
export function createWorktreeSetupOrchestrator(
  gitHelper: GitHelper,
  config: PandoConfig
): WorktreeSetupOrchestrator {
  return new WorktreeSetupOrchestrator(gitHelper, config)
}
