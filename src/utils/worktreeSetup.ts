import type { PandoConfig, RsyncConfig, SymlinkConfig } from '../config/schema'
import type { GitHelper } from './git'
import {
  createRsyncHelper,
  createSymlinkHelper,
  FileOperationTransaction,
  RsyncHelper,
  SymlinkHelper,
  type RsyncResult,
  type SymlinkResult,
} from './fileOps'

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
  async setupNewWorktree(
    worktreePath: string,
    options: SetupOptions = {}
  ): Promise<SetupResult> {
    const startTime = Date.now()
    const warnings: string[] = []
    let rsyncResult: RsyncResult | undefined
    let symlinkResult: SymlinkResult | undefined
    let rolledBack = false

    try {
      // ============================================================
      // Phase 1: Initialization
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.INIT, 'Initializing setup')

      // TODO: Merge configuration with overrides
      // Merge config.rsync with options.rsyncOverride
      // Merge config.symlink with options.symlinkOverride

      // TODO: Get source tree path (main worktree)
      // Use gitHelper.getMainWorktreePath()

      // TODO: Validate paths exist
      // Check source and worktree paths are valid

      // ============================================================
      // Phase 2: Create Checkpoint
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.CHECKPOINT, 'Creating checkpoint')

      // TODO: Create transaction checkpoint
      // Snapshot worktree state for potential rollback
      // await this.transaction.createCheckpoint('worktree', worktreePath)

      // ============================================================
      // Phase 3: Symlinks (Before Rsync)
      // ============================================================
      if (!options.skipSymlink && this.config.symlink.beforeRsync) {
        this.reportProgress(
          options.onProgress,
          SetupPhase.SYMLINK_BEFORE,
          'Creating symlinks (before rsync)'
        )

        // TODO: Create symlinks
        // 1. Use symlinkHelper.createSymlinks()
        // 2. Pass source and target directories
        // 3. Use merged symlink config
        // 4. Store result in symlinkResult
        // 5. Add warnings if any conflicts were skipped
      }

      // ============================================================
      // Phase 4: Rsync
      // ============================================================
      if (!options.skipRsync && this.config.rsync.enabled) {
        this.reportProgress(options.onProgress, SetupPhase.RSYNC, 'Copying files with rsync')

        // TODO: Check rsync is installed
        // Throw RsyncNotInstalledError if not available

        // TODO: Build exclude patterns
        // Combine:
        // - .git directory (always)
        // - Symlinked files (don't copy over symlinks)
        // - Config excludes
        // - Override excludes

        // TODO: Execute rsync
        // 1. Use rsyncHelper.rsync()
        // 2. Pass source and destination
        // 3. Pass merged rsync config
        // 4. Stream progress to onProgress callback
        // 5. Store result in rsyncResult
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

        // TODO: Create symlinks
        // Same as Phase 3, but handle conflicts differently
        // May need to replace files that were copied by rsync
        // Use replaceExisting option
      }

      // ============================================================
      // Phase 6: Validation
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.VALIDATION, 'Validating setup')

      // TODO: Verify worktree is in good state
      // - Check worktree still exists
      // - Verify symlinks point to correct targets
      // - Check for any unexpected errors
      // - Add warnings for any issues

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
