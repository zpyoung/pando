import { Args, Command, Flags } from '@oclif/core'
import { createGitHelper } from '../utils/git.js'
import { loadConfig } from '../config/loader.js'
import { createWorktreeSetupOrchestrator, SetupPhase } from '../utils/worktreeSetup.js'
import { jsonFlag, pathFlag } from '../utils/common-flags.js'
import { ErrorHelper } from '../utils/errors.js'

/**
 * Add a new git worktree
 *
 * Creates a new working tree linked to the current repository.
 * After creation, optionally rsyncs files and creates symlinks
 * based on configuration.
 */
export default class AddWorktree extends Command {
  static description = 'Add a new git worktree with optional rsync and symlink setup'

  static examples = [
    '<%= config.bin %> <%= command.id %> feature-x',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x',
    '<%= config.bin %> <%= command.id %> --path ../hotfix --branch hotfix --commit abc123',
    '<%= config.bin %> <%= command.id %> --path ../feature-y --branch feature-y --json',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --skip-rsync',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --symlink "package.json"',
  ]

  static args = {
    branch: Args.string({
      description: 'Branch name to checkout or create',
      required: false,
    }),
  }

  static flags = {
    // Basic worktree flags
    path: pathFlag,
    branch: Flags.string({
      char: 'b',
      description: 'Branch to checkout or create',
      required: false,
    }),
    commit: Flags.string({
      char: 'c',
      description: 'Commit hash to base the new branch on',
      required: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force create branch even if it exists (uses git worktree add -B)',
      default: false,
    }),
    'no-rebase': Flags.boolean({
      description: 'Skip rebasing existing branch onto source branch',
      default: false,
    }),

    // Rsync control flags
    'skip-rsync': Flags.boolean({
      description: 'Skip rsync operation (ignore config)',
      default: false,
    }),
    'rsync-flags': Flags.string({
      description: 'Override rsync flags (comma-separated)',
      multiple: true,
    }),
    'rsync-exclude': Flags.string({
      description: 'Additional rsync exclude patterns',
      multiple: true,
    }),

    // Symlink control flags
    'skip-symlink': Flags.boolean({
      description: 'Skip symlink creation (ignore config)',
      default: false,
    }),
    symlink: Flags.string({
      description: 'Additional symlink patterns (overrides config)',
      multiple: true,
    }),
    'absolute-symlinks': Flags.boolean({
      description: 'Use absolute paths for symlinks instead of relative',
      default: false,
    }),

    // Output flags

    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags, args } = await this.parse(AddWorktree)

    // Use positional arg as branch if --branch is not provided
    if (args.branch && !flags.branch) {
      flags.branch = args.branch
    }

    const startTime = Date.now()

    const { spinner, chalk } = await this.initializeUI(flags.json)

    try {
      // Initialize git helper first to get git root
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()
      if (!isRepo) {
        ErrorHelper.validation(
          this,
          'Not a git repository. Run this command from within a git repository.',
          flags.json
        )
      }

      // Load config before validation so we can use default path
      const config = await this.loadAndMergeConfig(
        flags as Record<string, unknown>,
        gitHelper,
        spinner
      )

      // Get git root for path resolution
      const gitRoot = await gitHelper.getRepositoryRoot()

      // Validate and initialize with config
      const { gitHelper: _gitHelper, resolvedPath } = await this.validateAndInitialize(
        flags as Record<string, unknown>,
        spinner,
        config,
        gitRoot
      )

      const worktreeInfo = await this.createWorktree(
        flags as Record<string, unknown>,
        gitHelper,
        resolvedPath,
        spinner,
        config
      )
      const setupResult = await this.runSetup(
        flags as Record<string, unknown>,
        config,
        gitHelper,
        resolvedPath,
        spinner
      )
      this.formatOutput(
        flags as Record<string, unknown>,
        worktreeInfo,
        setupResult,
        Date.now() - startTime,
        chalk
      )
    } catch (error) {
      await this.handleError(error, flags as Record<string, unknown>, chalk, spinner)
    }
  }

  /**
   * Initialize UI components (spinner and chalk)
   */
  private async initializeUI(isJson: boolean): Promise<{
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
    chalk: Awaited<typeof import('chalk').default> | null
  }> {
    const ora = !isJson ? (await import('ora')).default : null
    const spinner = ora ? ora() : null
    const chalk = !isJson ? (await import('chalk')).default : null

    return { spinner, chalk }
  }

  /**
   * Phase 1: Initialize and validate
   */
  private async validateAndInitialize(
    flags: Record<string, unknown>,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    config: Awaited<ReturnType<typeof loadConfig>>,
    gitRoot: string
  ): Promise<{ gitHelper: ReturnType<typeof createGitHelper>; resolvedPath: string }> {
    if (spinner) {
      spinner.start('Validating path...')
    }

    const gitHelper = createGitHelper()

    // Resolve path: CLI flag > config default > error
    const fs = await import('fs-extra')
    // Validate: require either --branch or --path (or both)
    if (!flags.branch && !flags.path) {
      ErrorHelper.validation(
        this,
        'Either --branch or --path is required.',
        flags.json as boolean | undefined
      )
    }

    const path = await import('path')
    let worktreePath: string

    if (flags.path) {
      // Path provided via flag
      worktreePath = String(flags.path)
    } else if (config.worktree.defaultPath && flags.branch) {
      // Use config default path + branch name
      // Sanitize branch name: convert slashes to underscores for filesystem safety
      const sanitizedBranch = String(flags.branch).replace(/\//g, '_')
      // Append sanitized branch name to default path
      worktreePath = path.join(config.worktree.defaultPath, sanitizedBranch)
    } else {
      // No path flag and no usable config default
      ErrorHelper.validation(
        this,
        'Path is required. Provide --path flag or set worktree.defaultPath in config.',
        flags.json as boolean | undefined
      )
    }

    // Resolve path (relative to git root if not absolute)
    const resolvedPath = path.isAbsolute(worktreePath)
      ? worktreePath
      : path.resolve(gitRoot, worktreePath)

    if (await fs.pathExists(resolvedPath)) {
      ErrorHelper.validation(
        this,
        `Path already exists: ${resolvedPath}`,
        flags.json as boolean | undefined
      )
    }

    // Validate force flag requires branch
    if (flags.force && !flags.branch) {
      ErrorHelper.validation(
        this,
        'The --force flag requires --branch to be specified',
        flags.json as boolean | undefined
      )
    }

    // Validate branch/commit combination when force is NOT set
    if (flags.branch && flags.commit && !flags.force) {
      // Check if branch already exists
      const branchExists = await gitHelper.branchExists(String(flags.branch))
      if (branchExists) {
        ErrorHelper.validation(
          this,
          `Branch '${String(flags.branch)}' already exists. Choose a different branch name, use --force to reset the branch, or omit --branch to checkout the commit in detached HEAD state.`,
          flags.json as boolean | undefined
        )
      }
    }

    return { gitHelper, resolvedPath }
  }

  /**
   * Phase 2: Load configuration
   */
  private async loadAndMergeConfig(
    flags: Record<string, unknown>,
    gitHelper: ReturnType<typeof createGitHelper>,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
  ): Promise<Awaited<ReturnType<typeof loadConfig>>> {
    if (spinner) {
      spinner.text = 'Loading configuration...'
    }

    // Get git root directory
    const gitRoot = await gitHelper.getRepositoryRoot()

    // Load config from all sources (includes environment variables automatically)
    let config = await loadConfig({
      cwd: process.cwd(),
      gitRoot,
    })

    // Apply flag overrides
    if (flags['skip-rsync']) {
      config.rsync.enabled = false
    }
    if (flags['rsync-flags']) {
      const rsyncFlags = flags['rsync-flags'] as string[]
      config.rsync.flags = rsyncFlags.flatMap((f: string) => f.split(','))
    }
    if (flags['rsync-exclude']) {
      const rsyncExclude = flags['rsync-exclude'] as string[]
      config.rsync.exclude = [
        ...config.rsync.exclude,
        ...rsyncExclude.flatMap((e: string) => e.split(',')),
      ]
    }
    if (flags['skip-symlink']) {
      config.symlink.patterns = []
    }
    if (flags.symlink) {
      const symlinkPatterns = flags.symlink as string[]
      config.symlink.patterns = symlinkPatterns.flatMap((s: string) => s.split(','))
    }
    if (flags['absolute-symlinks']) {
      config.symlink.relative = false
    }

    return config
  }

  /**
   * Phase 3: Create worktree
   */
  private async createWorktree(
    flags: Record<string, unknown>,
    gitHelper: ReturnType<typeof createGitHelper>,
    resolvedPath: string,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    config: Awaited<ReturnType<typeof loadConfig>>
  ): Promise<{
    path: string
    branch: string | null
    commit: string
    rebased?: boolean
    rebaseSourceBranch?: string
  }> {
    if (spinner) {
      spinner.text = 'Creating worktree...'
    }

    // Get source branch BEFORE creating worktree (we're on it now)
    let sourceBranch: string | null = null
    try {
      sourceBranch = await gitHelper.getCurrentBranch()
    } catch {
      // In detached HEAD state, can't determine source branch
      sourceBranch = null
    }

    let worktreeResult
    try {
      worktreeResult = await gitHelper.addWorktree(resolvedPath, {
        branch: flags.branch as string | undefined,
        commit: flags.commit as string | undefined,
        force: flags.force as boolean | undefined,
        skipPostCreate: true,
      })
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        'Failed to create worktree',
        flags.json as boolean | undefined
      )
    }

    // Determine if we should rebase
    const shouldRebase =
      worktreeResult.isExistingBranch &&
      config.worktree.rebaseOnAdd !== false &&
      !flags['no-rebase'] &&
      sourceBranch !== null &&
      worktreeResult.branch !== sourceBranch // Don't rebase onto itself

    let rebased = false
    if (shouldRebase && worktreeResult.branch) {
      if (spinner) {
        spinner.text = `Rebasing ${worktreeResult.branch} onto ${sourceBranch}...`
      }

      const rebaseSuccess = await gitHelper.rebaseBranchInWorktree(resolvedPath, sourceBranch!)

      if (rebaseSuccess) {
        rebased = true
        // Update commit hash after rebase
        const gitInWorktree = (await import('simple-git')).simpleGit(resolvedPath)
        const newCommit = await gitInWorktree.revparse(['HEAD'])
        worktreeResult.commit = newCommit.trim()
      } else {
        // Warn but don't fail
        ErrorHelper.warn(
          this,
          `Failed to rebase ${worktreeResult.branch} onto ${sourceBranch}. You may need to rebase manually.`,
          flags.json as boolean | undefined
        )
      }
    }

    return {
      path: worktreeResult.path,
      branch: worktreeResult.branch,
      commit: worktreeResult.commit,
      rebased,
      rebaseSourceBranch: rebased ? sourceBranch! : undefined,
    }
  }

  /**
   * Phase 4: Post-creation setup
   */
  private async runSetup(
    flags: Record<string, unknown>,
    config: Awaited<ReturnType<typeof loadConfig>>,
    gitHelper: ReturnType<typeof createGitHelper>,
    resolvedPath: string,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
  ): Promise<
    Awaited<ReturnType<ReturnType<typeof createWorktreeSetupOrchestrator>['setupNewWorktree']>>
  > {
    const orchestrator = createWorktreeSetupOrchestrator(gitHelper, config)

    const setupOptions = {
      skipRsync: flags['skip-rsync'] as boolean | undefined,
      skipSymlink: flags['skip-symlink'] as boolean | undefined,

      onProgress: this.buildProgressCallback(spinner, flags.json as boolean),
    }

    try {
      return await orchestrator.setupNewWorktree(resolvedPath, setupOptions)
    } catch (error) {
      if (spinner) {
        spinner.fail('Setup failed')
      }
      throw error
    }
  }

  /**
   * Build progress callback for setup operations
   */
  private buildProgressCallback(
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    isJson: boolean
  ): (phase: SetupPhase, _message: string) => void {
    return (phase: SetupPhase, _message: string): void => {
      if (spinner) {
        // Update spinner with phase-specific messages
        switch (phase) {
          case SetupPhase.INIT:
            spinner.text = 'Initializing setup...'
            break
          case SetupPhase.CHECKPOINT:
            spinner.text = 'Creating checkpoint...'
            break
          case SetupPhase.SYMLINK_BEFORE:
            spinner.text = 'Creating symlinks (before rsync)...'
            break
          case SetupPhase.RSYNC:
            spinner.text = 'Syncing files with rsync...'
            break
          case SetupPhase.SYMLINK_AFTER:
            spinner.text = 'Creating symlinks (after rsync)...'
            break
          case SetupPhase.VALIDATION:
            spinner.text = 'Validating setup...'
            break
          case SetupPhase.COMPLETE:
            spinner.succeed('Setup complete')
            break
          case SetupPhase.ROLLBACK:
            spinner.fail('Setup failed, rolling back...')
            break
        }
      } else if (isJson) {
        // Log phase changes for JSON mode (silent unless debugging)
        // Could add verbose flag later to control this
      }
    }
  }

  /**
   * Phase 5: Output formatting
   */
  private formatOutput(
    flags: Record<string, unknown>,
    worktreeInfo: {
      path: string
      branch: string | null
      commit: string
      rebased?: boolean
      rebaseSourceBranch?: string
    },
    setupResult: Awaited<
      ReturnType<ReturnType<typeof createWorktreeSetupOrchestrator>['setupNewWorktree']>
    >,
    duration: number,
    chalk: Awaited<typeof import('chalk').default> | null
  ): void {
    if (flags.json) {
      // JSON output
      this.log(
        JSON.stringify(
          {
            success: true,
            worktree: {
              path: worktreeInfo.path,
              branch: worktreeInfo.branch,
              commit: worktreeInfo.commit,
              rebased: worktreeInfo.rebased || false,
              rebaseSourceBranch: worktreeInfo.rebaseSourceBranch || null,
            },
            setup: {
              rsync: setupResult.rsyncResult
                ? {
                    filesTransferred: setupResult.rsyncResult.filesTransferred,
                    totalSize: setupResult.rsyncResult.totalSize,
                  }
                : null,
              symlink: setupResult.symlinkResult
                ? {
                    created: setupResult.symlinkResult.created,
                    skipped: setupResult.symlinkResult.skipped,
                    conflictCount: setupResult.symlinkResult.conflicts.length,
                    conflicts: setupResult.symlinkResult.conflicts,
                  }
                : null,
            },
            duration,
            warnings: setupResult.warnings,
          },
          null,
          2
        )
      )
    } else {
      // Human-readable output
      if (!chalk) {
        ErrorHelper.unexpected(this, new Error('Chalk not initialized for human-readable output'))
      }
      const output: string[] = []

      // Success header
      output.push(chalk.green(`✓ Worktree created at ${worktreeInfo.path}`))
      if (worktreeInfo.branch) {
        const branchInfo = worktreeInfo.rebased
          ? `${worktreeInfo.branch} (rebased onto ${worktreeInfo.rebaseSourceBranch})`
          : worktreeInfo.branch
        output.push(chalk.gray(`  Branch: ${branchInfo}`))
      }
      output.push(chalk.gray(`  Commit: ${worktreeInfo.commit.substring(0, 7)}`))
      output.push('')

      // Rsync results
      if (setupResult.rsyncResult) {
        const { filesTransferred, totalSize } = setupResult.rsyncResult
        const mbTotal = (totalSize / (1024 * 1024)).toFixed(2)
        output.push(
          chalk.green(`✓ Files synced: ${filesTransferred.toLocaleString()} files (${mbTotal} MB)`)
        )
      }

      // Symlink results
      if (setupResult.symlinkResult) {
        const { created, skipped, conflicts } = setupResult.symlinkResult
        if (created > 0) {
          output.push(chalk.green(`✓ Symlinks created: ${created} files`))
        }
        if (skipped > 0) {
          output.push(chalk.yellow(`⚠ Symlinks skipped: ${skipped} files`))
        }
        if (conflicts.length > 0) {
          output.push(chalk.yellow(`⚠ Symlink conflicts: ${conflicts.length} files`))
          // Show conflict details
          conflicts.forEach((conflict: { source: string; target: string; reason: string }) => {
            output.push(chalk.yellow(`    • ${conflict.target}`))
            output.push(chalk.gray(`      Source: ${conflict.source}`))
            output.push(chalk.gray(`      Reason: ${conflict.reason}`))
          })
        }
      }

      // Warnings
      if (setupResult.warnings.length > 0) {
        output.push('')
        output.push(chalk.yellow('⚠ Warnings:'))
        setupResult.warnings.forEach((warning: string) => {
          output.push(chalk.yellow(`  - ${warning}`))
        })
      }

      // Footer
      output.push('')
      output.push(chalk.cyan(`Ready to use: cd ${worktreeInfo.path}`))
      output.push(chalk.gray(`Duration: ${(duration / 1000).toFixed(2)}s`))

      this.log(output.join('\n'))
    }
  }

  /**
   * Centralized error handling
   */
  private async handleError(
    error: unknown,
    flags: Record<string, unknown>,
    chalk: Awaited<typeof import('chalk').default> | null,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
  ): Promise<void> {
    if (spinner) {
      spinner.fail('Failed')
    }

    // Handle SetupError
    if (error instanceof Error && error.name === 'SetupError') {
      const setupError = error as Error & {
        result: {
          rolledBack: boolean
          warnings: string[]
          duration: number
          symlinkResult?: { conflicts: Array<{ source: string; target: string; reason: string }> }
        }
      }
      const result = setupError.result

      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: setupError.message,
              rolledBack: result.rolledBack,
              warnings: result.warnings,
              duration: result.duration,
              symlinkConflicts: result.symlinkResult?.conflicts || [],
            },
            null,
            2
          )
        )
      } else {
        if (!chalk) {
          ErrorHelper.unexpected(this, new Error('Chalk not initialized for error output'))
        }

        // Build error message with symlink conflicts if present
        let errorMessage = 'Setup failed'
        if (result.symlinkResult?.conflicts && result.symlinkResult.conflicts.length > 0) {
          const conflictDetails = result.symlinkResult.conflicts
            .map((c) => `  • Target: ${c.target}\n    Source: ${c.source}\n    Reason: ${c.reason}`)
            .join('\n\n')
          errorMessage +=
            `\n\nSymlink conflicts (${result.symlinkResult.conflicts.length}):\n\n` +
            conflictDetails +
            '\n\nResolve conflicts manually or use --skip-symlink'
        }

        ErrorHelper.operation(
          this,
          setupError,
          errorMessage,
          false // Not JSON mode
        )
      }
      return
    }

    // Handle RsyncNotInstalledError
    const { RsyncNotInstalledError } = await import('../utils/fileOps.js')
    if (error instanceof RsyncNotInstalledError) {
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: 'rsync is not installed',
              hint: 'Install rsync or use --skip-rsync flag',
            },
            null,
            2
          )
        )
      } else {
        if (!chalk) {
          ErrorHelper.unexpected(this, new Error('Chalk not initialized for error output'))
        }
        ErrorHelper.validation(
          this,
          'rsync is not installed or not in PATH\n\nInstall rsync to use file syncing:\n  • macOS: brew install rsync\n  • Ubuntu/Debian: apt install rsync\n  • Windows: Install via WSL or use --skip-rsync\n\nOr skip rsync with: --skip-rsync',
          false // Not JSON mode
        )
      }
      return
    }

    // Handle SymlinkConflictError
    const { SymlinkConflictError } = await import('../utils/fileOps.js')
    if (
      error instanceof SymlinkConflictError &&
      'conflicts' in error &&
      Array.isArray(error.conflicts)
    ) {
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: 'symlink conflicts',
              conflicts: error.conflicts,
            },
            null,
            2
          )
        )
      } else {
        const conflictDetails = error.conflicts
          .map(
            (c: { source: string; target: string; reason: string }) =>
              `  • Target: ${c.target}\n    Source: ${c.source}\n    Reason: ${c.reason}`
          )
          .join('\n\n')
        ErrorHelper.operation(
          this,
          error as Error,
          'Symlink conflicts detected:\n\n' +
            conflictDetails +
            '\n\nResolve conflicts manually or use --skip-symlink',
          false // Not JSON mode
        )
      }
      return
    }

    // Generic error
    if (flags.json) {
      this.log(
        JSON.stringify(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        )
      )
      this.exit(1)
    } else {
      ErrorHelper.operation(
        this,
        error instanceof Error ? error : new Error(String(error)),
        'Operation failed',
        false // Not JSON mode
      )
    }
  }
}
