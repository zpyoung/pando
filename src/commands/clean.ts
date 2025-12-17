import { Command, Flags } from '@oclif/core'
import { createGitHelper, type StaleWorktreeInfo, type GitHelper } from '../utils/git.js'
import { jsonFlag, forceFlag } from '../utils/common-flags.js'
import { ErrorHelper } from '../utils/errors.js'
import { checkbox, confirm } from '@inquirer/prompts'
import { loadConfig } from '../config/loader.js'

/**
 * Result interfaces for JSON output
 */
interface RemovedWorktree {
  path: string
  branch: string | null
  branchDeleted: boolean
  staleReason: string
}

interface SkippedWorktree {
  path: string
  reason: string
}

interface CleanError {
  path: string
  error: string
}

interface CleanResult {
  status: 'success' | 'error' | 'nothing_to_clean'
  staleWorktrees: StaleWorktreeInfo[]
  removed: RemovedWorktree[]
  skipped: SkippedWorktree[]
  errors: CleanError[]
}

/**
 * Clean stale git worktrees
 *
 * Detects and removes worktrees with merged branches, deleted upstream
 * tracking branches, or prunable directories.
 */
export default class CleanWorktree extends Command {
  static description = 'Clean stale git worktrees (merged branches, gone upstream, prunable)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --fetch',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --target-branch develop',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --keep-branch',
  ]

  static flags = {
    json: jsonFlag,
    force: forceFlag,
    fetch: Flags.boolean({
      description: 'Run git fetch --prune before detection',
      default: false,
    }),
    'keep-branch': Flags.boolean({
      char: 'k',
      description: 'Keep local branch after worktree removal',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be removed without acting',
      default: false,
    }),
    'target-branch': Flags.string({
      char: 't',
      description: 'Branch to check merges against (default: main or master)',
    }),
  }

  /**
   * Get colored label for stale reason
   */
  private getReasonLabel(
    reason: 'merged' | 'gone' | 'prunable',
    chalk: typeof import('chalk').default
  ): string {
    switch (reason) {
      case 'merged':
        return chalk.green('[merged]')
      case 'gone':
        return chalk.red('[gone]')
      case 'prunable':
        return chalk.yellow('[prunable]')
    }
  }

  /**
   * Interactively select stale worktrees to clean
   */
  private async selectWorktreesInteractively(
    staleWorktrees: StaleWorktreeInfo[]
  ): Promise<string[]> {
    const chalk = (await import('chalk')).default

    const choices = staleWorktrees.map((wt) => {
      const branchDisplay = wt.branch || '(detached)'
      const reasonLabel = this.getReasonLabel(wt.staleReason!, chalk)
      const dirtyWarning = wt.hasUncommittedChanges ? chalk.yellow(' ⚠ uncommitted changes') : ''

      return {
        name: `${branchDisplay} ${reasonLabel}${dirtyWarning} (${wt.path})`,
        value: wt.path,
      }
    })

    return checkbox({
      message: 'Select stale worktrees to clean (spacebar to select, enter to confirm):',
      choices,
    })
  }

  /**
   * Confirm cleanup of worktrees with uncommitted changes
   */
  private async confirmDirtyRemoval(dirtyWorktrees: StaleWorktreeInfo[]): Promise<boolean> {
    const chalk = (await import('chalk')).default

    this.log(chalk.yellow('\n⚠ The following worktrees have uncommitted changes:'))
    for (const wt of dirtyWorktrees) {
      this.log(chalk.cyan(`  - ${wt.branch || '(detached)'} (${wt.path})`))
    }

    return confirm({
      message: 'Proceed with cleanup? Uncommitted changes will be lost.',
      default: false,
    })
  }

  /**
   * Output dry run results
   */
  private async outputDryRun(staleWorktrees: StaleWorktreeInfo[], isJson: boolean): Promise<void> {
    if (isJson) {
      const result: CleanResult = {
        status: 'success',
        staleWorktrees,
        removed: [],
        skipped: staleWorktrees.map((wt) => ({
          path: wt.path,
          reason: 'dry-run',
        })),
        errors: [],
      }
      this.log(JSON.stringify(result, null, 2))
    } else {
      const chalk = (await import('chalk')).default
      this.log('\nStale worktrees that would be cleaned:\n')
      for (const wt of staleWorktrees) {
        const branchDisplay = wt.branch || '(detached)'
        const reasonLabel = this.getReasonLabel(wt.staleReason!, chalk)
        const dirtyWarning = wt.hasUncommittedChanges ? chalk.yellow(' ⚠ uncommitted changes') : ''
        this.log(`  ${branchDisplay} ${reasonLabel}${dirtyWarning}`)
        this.log(chalk.dim(`    ${wt.path}`))
      }
      this.log(
        chalk.dim(
          `\n(${staleWorktrees.length} worktree${staleWorktrees.length > 1 ? 's' : ''} would be cleaned)`
        )
      )
    }
  }

  /**
   * Execute cleanup of selected worktrees
   */
  private async executeCleanup(
    gitHelper: GitHelper,
    selectedWorktrees: StaleWorktreeInfo[],
    flags: { force?: boolean; 'keep-branch'?: boolean; json?: boolean }
  ): Promise<CleanResult> {
    const result: CleanResult = {
      status: 'success',
      staleWorktrees: selectedWorktrees,
      removed: [],
      skipped: [],
      errors: [],
    }

    for (const worktree of selectedWorktrees) {
      try {
        // Determine if we need to force remove (uncommitted changes)
        const forceRemove = flags.force || worktree.hasUncommittedChanges

        // Remove worktree
        await gitHelper.removeWorktree(worktree.path, forceRemove)

        // Delete branch unless --keep-branch
        let branchDeleted = false
        if (worktree.branch && !flags['keep-branch']) {
          try {
            // Use force delete if --force flag is set or if branch might not be fully merged
            await gitHelper.deleteBranch(worktree.branch, flags.force)
            branchDeleted = true
          } catch (error) {
            // Branch deletion failed but worktree was removed
            // This is not critical, just log the issue
            const errorMsg = error instanceof Error ? error.message : String(error)
            if (!flags.json) {
              const chalk = (await import('chalk')).default
              this.log(
                chalk.yellow(`  ↳ Could not delete branch '${worktree.branch}': ${errorMsg}`)
              )
            }
          }
        }

        result.removed.push({
          path: worktree.path,
          branch: worktree.branch,
          branchDeleted,
          staleReason: worktree.staleReason!,
        })
      } catch (error) {
        result.errors.push({
          path: worktree.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (result.errors.length > 0 && result.removed.length === 0) {
      result.status = 'error'
    }

    return result
  }

  /**
   * Output cleanup results
   */
  private async outputResults(result: CleanResult, isJson: boolean): Promise<void> {
    if (isJson) {
      this.log(JSON.stringify(result, null, 2))
      if (result.status === 'error') {
        this.exit(1)
      }
      return
    }

    const chalk = (await import('chalk')).default

    // Show removed worktrees
    if (result.removed.length > 0) {
      this.log(
        chalk.green(
          `\n✓ Cleaned ${result.removed.length} worktree${result.removed.length > 1 ? 's' : ''}:`
        )
      )
      for (const removed of result.removed) {
        const branchInfo = removed.branch ? ` (${removed.branch})` : ''
        const branchStatus = removed.branchDeleted
          ? chalk.dim(' - branch deleted')
          : removed.branch
            ? chalk.dim(' - branch kept')
            : ''
        this.log(`  ${chalk.cyan(removed.path)}${branchInfo}${branchStatus}`)
      }
    }

    // Show errors
    if (result.errors.length > 0) {
      this.log(
        chalk.red(
          `\n✗ Failed to clean ${result.errors.length} worktree${result.errors.length > 1 ? 's' : ''}:`
        )
      )
      for (const error of result.errors) {
        this.log(`  ${chalk.cyan(error.path)}: ${chalk.yellow(error.error)}`)
      }
      this.exit(1)
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(CleanWorktree)

    try {
      // 1. Validate git repository
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()

      if (!isRepo) {
        ErrorHelper.validation(this, 'Not a git repository', flags.json ?? false)
        return
      }

      // 2. Load config
      const gitRoot = await gitHelper.getRepositoryRoot()
      const config = await loadConfig({ gitRoot })

      // Apply config with flag precedence (flag > config > default)
      const shouldFetch = flags.fetch || config.clean.fetch
      const targetBranch = flags['target-branch'] || config.worktree.targetBranch
      // Reuse worktree.deleteBranchOnRemove for branch deletion behavior
      // --keep-branch flag overrides config (deleteBranchOnRemove='none' is equivalent to keepBranch=true)
      const keepBranch = flags['keep-branch'] || config.worktree.deleteBranchOnRemove === 'none'

      // 3. Optionally fetch with prune
      if (shouldFetch) {
        try {
          if (!flags.json) {
            const chalk = (await import('chalk')).default
            this.log(chalk.dim('Fetching from remote with pruning...'))
          }
          await gitHelper.fetchWithPrune()
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          ErrorHelper.warn(
            this,
            `Fetch failed: ${errorMsg}. Continuing with local state.`,
            flags.json ?? false
          )
        }
      }

      // 4. Detect stale worktrees
      const staleWorktrees = await gitHelper.getStaleWorktrees(targetBranch)

      // 5. Handle "nothing to clean" case
      if (staleWorktrees.length === 0) {
        if (flags.json) {
          const result: CleanResult = {
            status: 'nothing_to_clean',
            staleWorktrees: [],
            removed: [],
            skipped: [],
            errors: [],
          }
          this.log(JSON.stringify(result, null, 2))
        } else {
          const chalk = (await import('chalk')).default
          this.log(chalk.green('No stale worktrees found!'))
        }
        return
      }

      // 6. Dry run - just show what would be removed
      if (flags['dry-run']) {
        await this.outputDryRun(staleWorktrees, flags.json ?? false)
        return
      }

      // 7. Interactive or force selection
      let selectedPaths: string[]
      if (flags.force || flags.json) {
        // Force/JSON mode: clean all stale worktrees
        selectedPaths = staleWorktrees.map((wt) => wt.path)
      } else {
        // Interactive mode: let user select
        selectedPaths = await this.selectWorktreesInteractively(staleWorktrees)
        if (selectedPaths.length === 0) {
          const chalk = (await import('chalk')).default
          this.log(chalk.yellow('No worktrees selected'))
          return
        }

        // Confirm if any selected worktrees have uncommitted changes
        const selectedWithChanges = staleWorktrees.filter(
          (wt) => selectedPaths.includes(wt.path) && wt.hasUncommittedChanges
        )
        if (selectedWithChanges.length > 0) {
          const confirmed = await this.confirmDirtyRemoval(selectedWithChanges)
          if (!confirmed) {
            const chalk = (await import('chalk')).default
            this.log(chalk.yellow('Cleanup cancelled'))
            return
          }
        }
      }

      // 8. Execute cleanup
      const selectedWorktrees = staleWorktrees.filter((wt) => selectedPaths.includes(wt.path))
      const result = await this.executeCleanup(gitHelper, selectedWorktrees, {
        force: flags.force,
        'keep-branch': keepBranch,
        json: flags.json,
      })

      // 9. Output results
      await this.outputResults(result, flags.json ?? false)
    } catch (error) {
      if (flags.json) {
        const result: CleanResult = {
          status: 'error',
          staleWorktrees: [],
          removed: [],
          skipped: [],
          errors: [
            {
              path: 'unknown',
              error: error instanceof Error ? error.message : String(error),
            },
          ],
        }
        this.log(JSON.stringify(result, null, 2))
        this.exit(1)
      } else {
        ErrorHelper.operation(
          this,
          error instanceof Error ? error : new Error(String(error)),
          'Failed to clean worktrees',
          false
        )
      }
    }
  }
}
