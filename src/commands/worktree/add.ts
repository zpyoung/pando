import { Command, Flags } from '@oclif/core'
import { createGitHelper } from '../../utils/git'
import { loadConfig } from '../../config/loader'
import { getEnvConfig } from '../../config/env'
import { createWorktreeSetupOrchestrator, SetupPhase } from '../../utils/worktreeSetup'

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
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x',
    '<%= config.bin %> <%= command.id %> --path ../hotfix --branch hotfix --commit abc123',
    '<%= config.bin %> <%= command.id %> --path ../feature-y --branch feature-y --json',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --skip-rsync',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --symlink "package.json"',
  ]

  static flags = {
    // Basic worktree flags
    path: Flags.string({
      char: 'p',
      description: 'Path for the new worktree',
      required: true,
    }),
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
    json: Flags.boolean({
      char: 'j',
      description: 'Output result in JSON format',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AddWorktree)
    const startTime = Date.now()

    // Import ora for spinners (if not JSON output)
    const ora = !flags.json ? (await import('ora')).default : null
    const spinner = ora ? ora() : null
    const chalk = !flags.json ? (await import('chalk')).default : null

    try {
      // ============================================================
      // Phase 1: Initialize and validate
      // ============================================================
      if (spinner) {
        spinner.start('Initializing...')
      }

      const gitHelper = createGitHelper()

      // Validate we're in a git repository
      const isRepo = await gitHelper.isRepository()
      if (!isRepo) {
        this.error('Not a git repository. Run this command from within a git repository.')
      }

      // Check if worktree path already exists
      const fs = await import('fs-extra')
      const path = await import('path')
      const resolvedPath = path.resolve(flags.path)

      if (await fs.pathExists(resolvedPath)) {
        this.error(`Path already exists: ${resolvedPath}`)
      }

      // Validate branch/commit if provided
      if (flags.branch && flags.commit) {
        // Check if branch already exists
        const branchExists = await gitHelper.branchExists(flags.branch)
        if (branchExists) {
          this.error(`Branch '${flags.branch}' already exists. Choose a different branch name or omit --branch to checkout the commit in detached HEAD state.`)
        }
      }

      // ============================================================
      // Phase 2: Load configuration
      // ============================================================
      if (spinner) {
        spinner.text = 'Loading configuration...'
      }

      // Get git root directory
      const gitRoot = await gitHelper.getRepositoryRoot()

      // Load config from all sources
      const baseConfig = await loadConfig({
        cwd: process.cwd(),
        gitRoot,
      })

      // Load environment variables
      const envConfig = getEnvConfig()

      // Merge environment config into base config
      let config = { ...baseConfig }
      if (envConfig.rsync) {
        config.rsync = { ...config.rsync, ...envConfig.rsync }
      }
      if (envConfig.symlink) {
        config.symlink = { ...config.symlink, ...envConfig.symlink }
      }

      // Apply flag overrides
      if (flags['skip-rsync']) {
        config.rsync.enabled = false
      }
      if (flags['rsync-flags']) {
        config.rsync.flags = flags['rsync-flags'].flatMap(f => f.split(','))
      }
      if (flags['rsync-exclude']) {
        config.rsync.exclude = [
          ...config.rsync.exclude,
          ...flags['rsync-exclude'].flatMap(e => e.split(','))
        ]
      }
      if (flags['skip-symlink']) {
        config.symlink.patterns = []
      }
      if (flags.symlink) {
        config.symlink.patterns = flags.symlink.flatMap(s => s.split(','))
      }
      if (flags['absolute-symlinks']) {
        config.symlink.relative = false
      }

      // ============================================================
      // Phase 3: Create worktree
      // ============================================================
      if (spinner) {
        spinner.text = 'Creating worktree...'
      }

      let worktreeInfo
      try {
        worktreeInfo = await gitHelper.addWorktree(resolvedPath, {
          branch: flags.branch,
          commit: flags.commit,
          skipPostCreate: true,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.error(`Failed to create worktree: ${errorMessage}`)
      }

      // ============================================================
      // Phase 4: Post-creation setup
      // ============================================================
      const orchestrator = createWorktreeSetupOrchestrator(gitHelper, config)

      // Build SetupOptions from flags
      const setupOptions = {
        skipRsync: flags['skip-rsync'],
        skipSymlink: flags['skip-symlink'],
        onProgress: (phase: SetupPhase, _message: string) => {
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
          } else if (flags.json) {
            // Log phase changes for JSON mode (silent unless debugging)
            // Could add verbose flag later to control this
          }
        },
      }

      let setupResult
      try {
        setupResult = await orchestrator.setupNewWorktree(resolvedPath, setupOptions)
      } catch (error) {
        if (spinner) {
          spinner.fail('Setup failed')
        }

        // Handle SetupError
        if (error instanceof Error && error.name === 'SetupError') {
          const setupError = error as any
          const result = setupError.result

          if (flags.json) {
            this.log(JSON.stringify({
              success: false,
              error: setupError.message,
              rolledBack: result.rolledBack,
              warnings: result.warnings,
              duration: result.duration,
            }, null, 2))
          } else {
            this.error([
              chalk!.red('✗ Setup failed:'),
              `  ${setupError.message}`,
              result.rolledBack ? chalk!.yellow('  Worktree has been removed (rolled back)') : chalk!.red('  WARNING: Worktree may be in inconsistent state'),
              result.warnings.length > 0 ? `\n${chalk!.yellow('⚠ Warnings:')}\n${result.warnings.map((w: string) => `  - ${w}`).join('\n')}` : '',
            ].filter(Boolean).join('\n'))
          }
          return
        }

        // Handle RsyncNotInstalledError
        const { RsyncNotInstalledError } = await import('../../utils/fileOps.js')
        if (error instanceof RsyncNotInstalledError) {
          if (flags.json) {
            this.log(JSON.stringify({
              success: false,
              error: 'rsync is not installed',
              hint: 'Install rsync or use --skip-rsync flag',
            }, null, 2))
          } else {
            this.error([
              chalk!.red('✗ rsync is not installed or not in PATH'),
              '',
              'Install rsync to use file syncing:',
              '  • macOS: brew install rsync',
              '  • Ubuntu/Debian: apt install rsync',
              '  • Windows: Install via WSL or use --skip-rsync',
              '',
              'Or skip rsync with: --skip-rsync',
            ].join('\n'))
          }
          return
        }

        // Handle SymlinkConflictError
        const { SymlinkConflictError } = await import('../../utils/fileOps.js')
        if (error instanceof SymlinkConflictError && 'conflicts' in error) {
          if (flags.json) {
            this.log(JSON.stringify({
              success: false,
              error: 'symlink conflicts',
              conflicts: error.conflicts,
            }, null, 2))
          } else {
            this.error([
              chalk!.red('✗ Symlink conflicts detected:'),
              ...error.conflicts.map((c: any) => `  • ${c.target}: ${c.reason}`),
              '',
              'Resolve conflicts manually or use --skip-symlink',
            ].join('\n'))
          }
          return
        }

        // Generic error
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (flags.json) {
          this.log(JSON.stringify({
            success: false,
            error: errorMessage,
          }, null, 2))
        } else {
          this.error(`Unexpected error: ${errorMessage}`)
        }
        return
      }

      // ============================================================
      // Phase 5: Output formatting
      // ============================================================
      const duration = Date.now() - startTime

      if (flags.json) {
        // JSON output
        this.log(JSON.stringify({
          success: true,
          worktree: {
            path: worktreeInfo.path,
            branch: worktreeInfo.branch,
            commit: worktreeInfo.commit,
          },
          setup: {
            rsync: setupResult.rsyncResult ? {
              filesTransferred: setupResult.rsyncResult.filesTransferred,
              totalSize: setupResult.rsyncResult.totalSize,
            } : null,
            symlink: setupResult.symlinkResult ? {
              created: setupResult.symlinkResult.created,
              skipped: setupResult.symlinkResult.skipped,
              conflicts: setupResult.symlinkResult.conflicts.length,
            } : null,
          },
          duration,
          warnings: setupResult.warnings,
        }, null, 2))
      } else {
        // Human-readable output
        const output: string[] = []

        // Success header
        output.push(chalk!.green(`✓ Worktree created at ${worktreeInfo.path}`))
        if (worktreeInfo.branch) {
          output.push(chalk!.gray(`  Branch: ${worktreeInfo.branch}`))
        }
        output.push(chalk!.gray(`  Commit: ${worktreeInfo.commit.substring(0, 7)}`))
        output.push('')

        // Rsync results
        if (setupResult.rsyncResult) {
          const { filesTransferred, totalSize } = setupResult.rsyncResult
          const mbTotal = (totalSize / (1024 * 1024)).toFixed(2)
          output.push(chalk!.green(`✓ Files synced: ${filesTransferred.toLocaleString()} files (${mbTotal} MB)`))
        }

        // Symlink results
        if (setupResult.symlinkResult) {
          const { created, skipped, conflicts } = setupResult.symlinkResult
          if (created > 0) {
            output.push(chalk!.green(`✓ Symlinks created: ${created} files`))
          }
          if (skipped > 0) {
            output.push(chalk!.yellow(`⚠ Symlinks skipped: ${skipped} files`))
          }
          if (conflicts.length > 0) {
            output.push(chalk!.yellow(`⚠ Symlink conflicts: ${conflicts.length} files`))
          }
        }

        // Warnings
        if (setupResult.warnings.length > 0) {
          output.push('')
          output.push(chalk!.yellow('⚠ Warnings:'))
          setupResult.warnings.forEach(warning => {
            output.push(chalk!.yellow(`  - ${warning}`))
          })
        }

        // Footer
        output.push('')
        output.push(chalk!.cyan(`Ready to use: cd ${worktreeInfo.path}`))
        output.push(chalk!.gray(`Duration: ${(duration / 1000).toFixed(2)}s`))

        this.log(output.join('\n'))
      }

    } catch (error) {
      if (spinner) {
        spinner.fail('Failed')
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      if (flags.json) {
        this.log(JSON.stringify({
          success: false,
          error: errorMessage,
        }, null, 2))
      } else {
        this.error(errorMessage)
      }
    }
  }
}
