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
import type { RsyncProgressData } from './rsyncProgress.js'

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
  SKIP_WORKTREE = 'skip_worktree',
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
  skipWorktreeResult?: { filesMarked: number; success: boolean }
  /**
   * Whether `git status` in the new worktree is empty after setup (files marked
   * skip-worktree are hidden by git itself). Undefined when the check could not
   * run (e.g. on the error path, after rollback).
   */
  cleanTree?: boolean
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
  /**
   * Guards against running rollback more than once. The SIGINT handler in
   * `pando add` and the setup catch-block can both fire (especially under a
   * mocked process.exit in tests), so the second invocation must be a no-op
   * rather than re-running git/file cleanup against already-removed state.
   */
  private hasRolledBack = false

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
    let skipWorktreeResult: { filesMarked: number; success: boolean } | undefined
    let rolledBack = false

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
      const fs = (await import('fs-extra')).default
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
      // Snapshot worktree state for potential rollback. This MUST happen
      // before any operation that can throw (including symlink planning
      // below) - otherwise a failure there leaves rollback() with no
      // 'worktree' checkpoint, and the already-created git worktree is never
      // cleaned up.
      this.transaction.createCheckpoint('worktree', { path: worktreePath })

      // Plan symlinks once: matched items minus (in strict mode) git-tracked
      // paths. The symlink phases and rsync exclusions all consume this plan so
      // every phase agrees on what will be symlinked. Tracked items that ARE
      // symlinked (allowTracked, the default) get hidden from git status via
      // skip-worktree in Phase 5.5.
      let symlinkItems: string[] = []
      if (!options.skipSymlink && symlinkConfig.patterns.length > 0) {
        const matches = await this.symlinkHelper.matchPatterns(
          sourceTreePath,
          symlinkConfig.patterns
        )

        if (symlinkConfig.allowTracked ?? true) {
          symlinkItems = matches
        } else {
          const trackedItems = await this.gitHelper.filterTrackedPaths(worktreePath, matches)
          if (trackedItems.length === 0) {
            symlinkItems = matches
          } else {
            const trackedSet = new Set(trackedItems)
            symlinkItems = matches.filter((item) => !trackedSet.has(item))
            warnings.push(
              `Skipped symlinking git-tracked path(s): ${trackedItems.join(', ')}. ` +
                `Symlinking tracked paths makes git status show them as deleted or modified. ` +
                `Add them to .gitignore (and remove them from the index), or set ` +
                `symlink.allowTracked = true to symlink them anyway.`
            )
          }
        }
      }

      // ============================================================
      // Phase 3: Symlinks (Before Rsync)
      // ============================================================
      if (!options.skipSymlink && symlinkConfig.beforeRsync) {
        this.reportProgress(
          options.onProgress,
          SetupPhase.SYMLINK_BEFORE,
          'Creating symlinks (before rsync)'
        )

        symlinkResult = await this.createPlannedSymlinks(
          sourceTreePath,
          worktreePath,
          symlinkConfig,
          symlinkItems
        )

        // Add warnings for skipped conflicts
        if (symlinkResult.conflicts.length > 0) {
          warnings.push(`Skipped ${symlinkResult.conflicts.length} symlink(s) due to conflicts`)
        }
      }

      // ============================================================
      // Phase 4: Rsync
      // ============================================================
      if (!options.skipRsync && rsyncConfig.enabled) {
        this.reportProgress(options.onProgress, SetupPhase.RSYNC, 'Syncing files with rsync...')

        // Which files may cross worktrees depends on the mode:
        // - onlyUntracked (default): sync only gitignored artifacts (.venv,
        //   node_modules, caches). Tracked files come from the target's own
        //   checkout, so nothing tracked can be clobbered regardless of which
        //   commits the two worktrees are on.
        // - full mirror (onlyUntracked=false): copy the whole source tree, but
        //   only when both worktrees are on the same commit - otherwise the
        //   source branch's tracked files would dirty the target.
        const onlyUntracked = rsyncConfig.onlyUntracked ?? true
        let filesFrom: string[] | undefined
        let runRsync = true

        if (onlyUntracked) {
          filesFrom = await this.gitHelper.listIgnoredFiles(sourceTreePath)
          if (filesFrom.length === 0) {
            runRsync = false
            this.reportProgress(
              options.onProgress,
              SetupPhase.RSYNC,
              'Skipped rsync - no ignored files to sync'
            )
          }
        } else {
          const sourceCommit = await this.gitHelper.getWorktreeCommit(sourceTreePath)
          const targetCommit = await this.gitHelper.getWorktreeCommit(worktreePath)

          if (sourceCommit !== targetCommit) {
            runRsync = false
            warnings.push(
              `Skipped rsync because source worktree (${sourceCommit.slice(0, 7)}) differs from target worktree (${targetCommit.slice(0, 7)}). This prevents tracked files from being copied across different commits.`
            )
            this.reportProgress(
              options.onProgress,
              SetupPhase.RSYNC,
              'Skipped rsync due to commit mismatch'
            )
          }
        }

        if (runRsync) {
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

          // ALWAYS exclude files/directories that will be symlinked (regardless of beforeRsync setting)
          // This prevents rsync from copying items that should be symlinks
          // Directories need trailing '/' to exclude the directory and all contents
          const pathModule = await import('path')
          for (const item of symlinkItems) {
            const fullPath = pathModule.default.join(sourceTreePath, item)
            try {
              const stats = await fs.stat(fullPath)
              if (stats.isDirectory()) {
                // For directories: use trailing slash to exclude directory and contents
                excludePatterns.push(`/${item}/`)
              } else {
                // For files: exclude the specific file
                excludePatterns.push(`/${item}`)
              }
            } catch (statError) {
              // Default to file pattern if stat fails, but warn about potential issues
              const errMsg = statError instanceof Error ? statError.message : String(statError)
              warnings.push(
                `Could not stat '${item}' for rsync exclusion (using file pattern): ${errMsg}`
              )
              excludePatterns.push(`/${item}`)
            }
          }

          // Execute rsync with progress callback
          rsyncResult = await this.rsyncHelper.rsync(sourceTreePath, worktreePath, rsyncConfig, {
            excludePatterns,
            filesFrom,
            onProgress: options.onProgress
              ? (progress: RsyncProgressData): void => {
                  const message = `Synced: ${progress.filesTransferred} files`
                  options.onProgress!(SetupPhase.RSYNC, message)
                }
              : undefined,
          })
        }
      }

      // ============================================================
      // Phase 5: Symlinks (After Rsync)
      // ============================================================
      if (!options.skipSymlink && !symlinkConfig.beforeRsync) {
        this.reportProgress(
          options.onProgress,
          SetupPhase.SYMLINK_AFTER,
          'Creating symlinks (after rsync)'
        )

        // Rsync already excluded these files, so no conflicts expected
        symlinkResult = await this.createPlannedSymlinks(
          sourceTreePath,
          worktreePath,
          symlinkConfig,
          symlinkItems
        )

        // Add warnings for any conflicts (shouldn't happen since rsync excluded them)
        if (symlinkResult.conflicts.length > 0) {
          warnings.push(
            `Could not create ${symlinkResult.conflicts.length} symlink(s) due to conflicts`
          )
        }
      }

      // ============================================================
      // Phase 5.5: Mark symlinked files as skip-worktree
      // ============================================================
      if (symlinkResult && symlinkResult.created > 0) {
        this.reportProgress(
          options.onProgress,
          SetupPhase.SKIP_WORKTREE,
          'Marking symlinked files as skip-worktree'
        )

        // Get relative paths of all symlinked files
        const symlinkPaths = await this.getSymlinkedFilePaths(worktreePath)

        if (symlinkPaths.length > 0) {
          const result = await this.gitHelper.setSkipWorktree(worktreePath, symlinkPaths)

          skipWorktreeResult = {
            filesMarked: result.filesMarked,
            success: result.success,
          }

          if (!result.success) {
            // Add warning but don't fail - worktree is still functional
            warnings.push(
              `Could not mark symlinked files as skip-worktree: ${result.error}. ` +
                `Git may show these files as modified.`
            )
          }
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

      // Clean-tree invariant: after setup, `git status` in the new worktree
      // must be empty (skip-worktree'd files are hidden by git itself). A dirty
      // tree here means setup polluted the checkout - surface it immediately
      // instead of letting the user discover it downstream. The symlinks pando
      // itself created are intentional state, not pollution: a symlink over a
      // tracked directory shows as untracked even when its files are hidden.
      let cleanTree: boolean | undefined
      try {
        const symlinkItemSet = new Set(symlinkItems)
        const dirtyPaths = (await this.gitHelper.getDirtyPaths(worktreePath)).filter(
          (dirtyPath) => !symlinkItemSet.has(dirtyPath)
        )
        cleanTree = dirtyPaths.length === 0
        if (!cleanTree) {
          const shown = dirtyPaths.slice(0, 10).join(', ')
          const more = dirtyPaths.length > 10 ? ` (+${dirtyPaths.length - 10} more)` : ''
          warnings.push(
            `Worktree is not clean after setup (${dirtyPaths.length} path(s)): ${shown}${more}. ` +
              `Likely cause: symlinked tracked files that could not be hidden via skip-worktree, ` +
              `or rsync copying tracked files (rsync.onlyUntracked = false).`
          )
        }
      } catch {
        // Status check is best-effort; setup itself succeeded
        cleanTree = undefined
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
        skipWorktreeResult,
        cleanTree,
        duration,
        warnings,
        rolledBack: false,
      }
    } catch (error) {
      // ============================================================
      // Error Handling: Rollback
      // ============================================================
      this.reportProgress(options.onProgress, SetupPhase.ROLLBACK, 'Error occurred, rolling back')

      const rollbackOutcome = await this.rollback(options.onProgress)
      rolledBack = rollbackOutcome.rolledBack
      warnings.push(...rollbackOutcome.warnings)

      const duration = Date.now() - startTime

      // Re-throw original error with context
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SetupError(
        `Setup failed: ${errorMessage}`,
        {
          success: false,
          rsyncResult,
          symlinkResult,
          skipWorktreeResult,
          duration,
          warnings,
          rolledBack,
        },
        error as Error
      )
    }
  }

  /**
   * Roll back all file operations recorded so far and remove the partially-set-up
   * git worktree.
   *
   * This is invoked both from the normal error path (when setup throws) and from
   * the SIGINT handler in `pando add` (when the user presses Ctrl+C mid-setup),
   * so the cleanup is identical in both cases.
   *
   * @param onProgress - Optional progress callback for rollback phases
   * @returns Whether rollback succeeded, plus any warnings produced
   */
  async rollback(
    onProgress?: (phase: SetupPhase, message: string) => void
  ): Promise<{ rolledBack: boolean; warnings: string[] }> {
    const warnings: string[] = []

    // Idempotency guard: a second rollback (e.g. SIGINT handler + catch-block
    // both firing) is a no-op. The transaction has already been cleared and the
    // worktree already removed, so re-running would just produce spurious
    // "failed to remove" warnings.
    if (this.hasRolledBack) {
      return { rolledBack: true, warnings }
    }
    this.hasRolledBack = true

    try {
      this.reportProgress(onProgress, SetupPhase.ROLLBACK, 'Rolling back file operations')

      // 1. Rollback file operations (symlinks, copied files)
      // rollback() returns preserved checkpoints since it clears internal state
      const rollbackResult = await this.transaction.rollback()

      // 2. Remove the worktree via git using preserved checkpoint
      const worktreeCheckpoint = rollbackResult.checkpoints.get('worktree')
      if (
        worktreeCheckpoint &&
        typeof worktreeCheckpoint === 'object' &&
        worktreeCheckpoint !== null &&
        'path' in worktreeCheckpoint
      ) {
        const worktreePath = (worktreeCheckpoint as { path: string }).path

        this.reportProgress(onProgress, SetupPhase.ROLLBACK, 'Removing git worktree')

        try {
          await this.gitHelper.removeWorktree(worktreePath, true) // force=true
        } catch (gitError) {
          // Fallback: remove directory if git metadata cleanup fails
          const fs = (await import('fs-extra')).default
          let directoryRemoved = false
          if (await fs.pathExists(worktreePath)) {
            await fs.remove(worktreePath)
            directoryRemoved = true
          }
          const gitErrMsg = gitError instanceof Error ? gitError.message : String(gitError)
          // Provide actionable warning about potential git metadata cleanup
          const cleanupHint = directoryRemoved
            ? `Directory was removed but git metadata in .git/worktrees/ may need manual cleanup. Run 'git worktree prune' to clean orphaned entries.`
            : `Failed to remove worktree via git: ${gitErrMsg}`
          warnings.push(cleanupHint)
        }
      }

      return { rolledBack: true, warnings }
    } catch (rollbackError) {
      const errorMsg =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      warnings.push(`Rollback failed: ${errorMsg}. Manual cleanup may be required.`)
      return { rolledBack: false, warnings }
    }
  }

  /**
   * Remove the checked-out copies of the planned items and symlink them to the
   * source tree. Shared by the before-rsync and after-rsync symlink phases.
   *
   * @param sourceTreePath - Main worktree the symlinks point into
   * @param worktreePath - New worktree receiving the symlinks
   * @param symlinkConfig - Merged symlink configuration
   * @param symlinkItems - Precomputed relative paths to symlink (the plan)
   * @returns Result of the symlink operations
   */
  private async createPlannedSymlinks(
    sourceTreePath: string,
    worktreePath: string,
    symlinkConfig: SymlinkConfig,
    symlinkItems: string[]
  ): Promise<SymlinkResult> {
    const fs = (await import('fs-extra')).default
    const path = await import('path')

    // Remove git-checked-out files that will be symlinked
    // Git automatically checks out tracked files when creating worktrees
    for (const item of symlinkItems) {
      const targetPath = path.default.join(worktreePath, item)
      if (await fs.pathExists(targetPath)) {
        await fs.remove(targetPath)
      }
    }

    return this.symlinkHelper.createSymlinks(sourceTreePath, worktreePath, symlinkConfig, {
      replaceExisting: true,
      skipConflicts: true,
      items: symlinkItems,
    })
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
   * Extract relative paths of symlinked files from transaction operations
   *
   * @param worktreePath - Base worktree path to make paths relative
   * @returns Array of relative file paths that were symlinked
   */
  private async getSymlinkedFilePaths(worktreePath: string): Promise<string[]> {
    const { OperationType } = await import('./fileOps.js')
    const path = await import('path')
    const symlinkOps = this.transaction
      .getOperations()
      .filter((op: Operation) => op.type === OperationType.CREATE_SYMLINK)

    return symlinkOps.map((op) => {
      // op.path is absolute (e.g., '/repo/feature/package.json')
      // Convert to relative path for git update-index
      return path.default.relative(worktreePath, op.path)
    })
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
