import { Command, Flags } from '@oclif/core'
import * as path from 'node:path'
import { createGitHelper, type WorktreeInfo, type GitHelper } from '../utils/git.js'
import { jsonFlag, forceFlag, pathFlag } from '../utils/common-flags.js'
import { ErrorHelper } from '../utils/errors.js'
import { loadConfig } from '../config/loader.js'
import type { DeleteBranchOption } from '../config/schema.js'
import { checkbox, confirm } from '@inquirer/prompts'

/**
 * Remove a git worktree
 *
 * Removes a working tree and cleans up associated metadata.
 * Includes safety checks to prevent data loss.
 */
export default class RemoveWorktree extends Command {
  static description = 'Remove a git worktree'

  static examples = [
    '<%= config.bin %> <%= command.id %> --path ../feature-x',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --keep-branch',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --force',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --json',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --delete-branch remote --force',
    '<%= config.bin %> <%= command.id %> # Interactive selection',
  ]

  static flags = {
    path: pathFlag,

    force: forceFlag,

    'delete-branch': Flags.string({
      char: 'd',
      description: 'Delete associated branch after removing worktree (none|local|remote)',
      options: ['none', 'local', 'remote'],
      default: undefined,
    }),

    'keep-branch': Flags.boolean({
      char: 'k',
      description: 'Keep the local branch (do not delete it)',
      default: false,
    }),

    json: jsonFlag,
  }

  /**
   * Interactively select worktrees to remove
   * @param worktrees - List of all worktrees (main worktree will be filtered out)
   * @returns Array of selected worktree paths
   */
  private async selectWorktreesInteractively(worktrees: WorktreeInfo[]): Promise<string[]> {
    const chalk = (await import('chalk')).default

    // Filter out main worktree (first entry)
    const removableWorktrees = worktrees.slice(1)

    if (removableWorktrees.length === 0) {
      this.error(chalk.yellow('No worktrees available to remove (only main worktree exists)'))
    }

    // Format choices for display
    const choices = removableWorktrees.map((wt) => {
      const branchDisplay = wt.branch || '(detached)'
      const prunableIndicator = wt.isPrunable ? ' (prunable)' : ''
      const label = `${branchDisplay} (${wt.path})${prunableIndicator}`

      return {
        name: label,
        value: wt.path,
      }
    })

    // Multi-select prompt
    const selectedPaths = await checkbox({
      message: 'Select worktrees to remove (use spacebar to select, enter to confirm):',
      choices,
      validate: (answer) => {
        if (answer.length === 0) {
          return 'You must select at least one worktree'
        }
        return true
      },
    })

    return selectedPaths
  }

  /**
   * Confirm removal of selected worktrees
   * @param paths - Array of worktree paths to be removed
   * @returns True if user confirms, false otherwise
   */
  private async confirmRemoval(paths: string[]): Promise<boolean> {
    const chalk = (await import('chalk')).default

    this.log(chalk.yellow('\nWorktrees to be removed:'))
    for (const p of paths) {
      this.log(chalk.cyan(`  - ${p}`))
    }

    return confirm({
      message: `Remove ${paths.length} worktree${paths.length > 1 ? 's' : ''}?`,
      default: false,
    })
  }

  /**
   * Confirm deletion of remote branch
   * @param branchName - Name of the branch to delete
   * @param remoteName - Name of the remote
   * @returns True if user confirms, false otherwise
   */
  private async confirmRemoteBranchDeletion(
    branchName: string,
    remoteName: string
  ): Promise<boolean> {
    const chalk = (await import('chalk')).default

    this.log(
      chalk.yellow(`\n⚠ You are about to delete branch '${branchName}' from remote '${remoteName}'`)
    )
    this.log(chalk.yellow('  This action cannot be undone.'))

    return confirm({
      message: `Delete remote branch '${remoteName}/${branchName}'?`,
      default: false,
    })
  }

  /**
   * Delete branch (local and optionally remote)
   * @param gitHelper - Git helper instance
   * @param branchName - Name of the branch
   * @param deleteOption - What to delete (none, local, remote)
   * @param force - Force delete without confirmation
   * @param isJson - Whether JSON output mode is enabled
   * @returns Branch deletion results
   */
  private async deleteBranch(
    gitHelper: GitHelper,
    branchName: string,
    deleteOption: DeleteBranchOption,
    force: boolean,
    isJson: boolean
  ): Promise<{
    localDeleted: boolean
    remoteDeleted: boolean
    localError?: string
    remoteError?: string
    skipped?: boolean
  }> {
    const result = {
      localDeleted: false,
      remoteDeleted: false,
      localError: undefined as string | undefined,
      remoteError: undefined as string | undefined,
      skipped: false,
    }

    if (deleteOption === 'none') {
      result.skipped = true
      return result
    }

    // Check if branch is merged before deleting (unless force)
    if (!force) {
      const isMerged = await gitHelper.isBranchMerged(branchName)
      if (!isMerged) {
        result.localError = `Branch '${branchName}' is not fully merged. Use --force to delete anyway.`
        return result
      }
    }

    // Delete local branch
    try {
      await gitHelper.deleteBranch(branchName, force)
      result.localDeleted = true
    } catch (error) {
      result.localError = error instanceof Error ? error.message : String(error)
      return result
    }

    // Delete remote branch if requested
    if (deleteOption === 'remote') {
      const remote = (await gitHelper.getBranchRemote(branchName)) || 'origin'
      const remoteBranchExists = await gitHelper.remoteBranchExists(branchName, remote)

      if (!remoteBranchExists) {
        // Remote branch doesn't exist, nothing to delete
        result.remoteDeleted = false
        return result
      }

      // Confirm remote deletion unless force or json
      if (!force && !isJson) {
        const confirmed = await this.confirmRemoteBranchDeletion(branchName, remote)
        if (!confirmed) {
          result.remoteError = 'Remote branch deletion cancelled by user'
          return result
        }
      }

      try {
        await gitHelper.deleteRemoteBranch(branchName, remote)
        result.remoteDeleted = true
      } catch (error) {
        result.remoteError = error instanceof Error ? error.message : String(error)
      }
    }

    return result
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(RemoveWorktree)

    // JSON mode requires --path (maintain scriptability)
    if (flags.json && !flags.path) {
      ErrorHelper.validation(
        this,
        'JSON mode requires --path flag. Interactive selection is not available with --json.',
        flags.json
      )
    }

    try {
      // 1. Validate the repository is a git repo
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()

      if (!isRepo) {
        if (flags.json) {
          this.log(
            JSON.stringify({
              success: false,
              error: 'Not a git repository',
            })
          )
          this.exit(1)
        } else {
          ErrorHelper.validation(this, 'Not a git repository', false)
        }
      }

      // 2. Load config for branch deletion settings
      const gitRoot = await gitHelper.getRepositoryRoot()
      const config = await loadConfig({ gitRoot })

      // Determine delete-branch option (--keep-branch takes precedence, then flag, then config)
      const deleteBranchOption: DeleteBranchOption = flags['keep-branch']
        ? 'none'
        : (flags['delete-branch'] as DeleteBranchOption) ||
          config.worktree.deleteBranchOnRemove ||
          'local'

      // 3. Get list of worktrees
      const worktrees = await gitHelper.listWorktrees()

      // 3. Determine paths to remove (either from flag or interactive selection)
      let pathsToRemove: string[]

      if (flags.path) {
        // Direct mode: validate single path
        const absolutePath = path.resolve(flags.path)
        const worktree = worktrees.find(
          (w) => path.resolve(w.path) === absolutePath || w.path === flags.path
        )

        if (!worktree) {
          if (flags.json) {
            this.log(
              JSON.stringify({
                success: false,
                error: `Worktree not found at ${flags.path}`,
              })
            )
            this.exit(1)
          } else {
            ErrorHelper.validation(this, `Worktree not found at ${flags.path}`, false)
          }
        }

        pathsToRemove = [worktree.path]
      } else {
        // Interactive mode: select worktrees
        pathsToRemove = await this.selectWorktreesInteractively(worktrees)

        // Confirm removal
        const confirmed = await this.confirmRemoval(pathsToRemove)
        if (!confirmed) {
          const chalk = (await import('chalk')).default
          this.log(chalk.yellow('Removal cancelled'))
          return
        }
      }

      // 4. Remove worktrees (batch processing with error resilience)
      const results: Array<{
        path: string
        success: boolean
        error?: string
        branch?: string | null
        branchDeletion?: {
          localDeleted: boolean
          remoteDeleted: boolean
          localError?: string
          remoteError?: string
          skipped?: boolean
        }
      }> = []

      for (const worktreePath of pathsToRemove) {
        try {
          // Find worktree info
          const worktree = worktrees.find((w) => w.path === worktreePath)
          if (!worktree) {
            results.push({
              path: worktreePath,
              success: false,
              error: 'Worktree not found',
            })
            continue
          }

          // Check for uncommitted changes (unless --force)
          let forceRemove = flags.force
          if (!forceRemove) {
            const hasUncommitted = await gitHelper.hasUncommittedChanges(worktree.path)

            if (hasUncommitted) {
              if (flags.json) {
                results.push({
                  path: worktreePath,
                  success: false,
                  error: 'Has uncommitted changes (use --force to remove anyway)',
                  branch: worktree.branch,
                })
                continue
              }

              // Prompt user to force remove
              const chalk = (await import('chalk')).default

              this.log(chalk.yellow(`\nWorktree '${worktreePath}' has uncommitted changes.`))

              const confirmForce = await confirm({
                message: 'Do you want to force remove it?',
                default: false,
              })

              if (!confirmForce) {
                results.push({
                  path: worktreePath,
                  success: false,
                  error: 'Has uncommitted changes (use --force to remove anyway)',
                  branch: worktree.branch,
                })
                continue
              }

              forceRemove = true
            }
          }

          // Execute removal
          await gitHelper.removeWorktree(worktree.path, forceRemove as boolean | undefined)

          // Delete branch if requested and branch exists
          let branchDeletion
          if (worktree.branch && deleteBranchOption !== 'none') {
            branchDeletion = await this.deleteBranch(
              gitHelper,
              worktree.branch,
              deleteBranchOption,
              flags.force ?? false,
              flags.json ?? false
            )
          }

          results.push({
            path: worktreePath,
            success: true,
            branch: worktree.branch,
            branchDeletion,
          })
        } catch (error) {
          results.push({
            path: worktreePath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // 5. Format output based on --json flag
      if (flags.json) {
        // JSON mode (only for single path)
        const result = results[0]
        if (!result) {
          this.log(JSON.stringify({ success: false, error: 'No results' }))
          this.exit(1)
        }

        this.log(
          JSON.stringify({
            success: result.success,
            path: result.path,
            branch: result.branch,
            forced: flags.force,
            deleteBranchOption: deleteBranchOption,
            branchDeletion: result.branchDeletion,
            error: result.error,
          })
        )
        if (!result.success) {
          this.exit(1)
        }
      } else {
        // Human-readable output
        const chalk = (await import('chalk')).default
        const successCount = results.filter((r) => r.success).length
        const failureCount = results.filter((r) => !r.success).length

        // Show results
        if (successCount > 0) {
          this.log(
            chalk.green(
              `\n✓ Successfully removed ${successCount} worktree${successCount > 1 ? 's' : ''}:`
            )
          )
          for (const result of results.filter((r) => r.success)) {
            let branchInfo = result.branch ? ` (${result.branch})` : ''
            this.log(`  ${chalk.cyan(result.path)}${branchInfo}`)

            // Show branch deletion results
            if (result.branchDeletion && !result.branchDeletion.skipped) {
              if (result.branchDeletion.localDeleted) {
                this.log(chalk.green(`    ↳ Local branch '${result.branch}' deleted`))
              }
              if (result.branchDeletion.remoteDeleted) {
                this.log(chalk.green(`    ↳ Remote branch '${result.branch}' deleted`))
              }
              if (result.branchDeletion.localError) {
                this.log(chalk.yellow(`    ↳ Local branch: ${result.branchDeletion.localError}`))
              }
              if (result.branchDeletion.remoteError) {
                this.log(chalk.yellow(`    ↳ Remote branch: ${result.branchDeletion.remoteError}`))
              }
            }
          }
        }

        if (failureCount > 0) {
          this.log(
            chalk.red(
              `\n✗ Failed to remove ${failureCount} worktree${failureCount > 1 ? 's' : ''}:`
            )
          )
          for (const result of results.filter((r) => !r.success)) {
            this.log(
              `  ${chalk.cyan(result.path)}: ${chalk.yellow(result.error || 'Unknown error')}`
            )
          }
        }

        if (flags.force && successCount > 0) {
          this.log(chalk.yellow('\n⚠ Forced removal (uncommitted changes may have been lost)'))
        }

        // Exit with error if any failures
        if (failureCount > 0) {
          this.exit(1)
        }
      }
    } catch (error) {
      // Handle errors appropriately
      if (flags.json) {
        this.log(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        )
        this.exit(1)
      } else {
        ErrorHelper.operation(
          this,
          error instanceof Error ? error : new Error(String(error)),
          'Failed to remove worktree',
          false
        )
      }
    }
  }
}
