import { Command } from '@oclif/core'
import * as path from 'node:path'
import { createGitHelper, type WorktreeInfo } from '../../utils/git.js'
import { jsonFlag, forceFlag, pathFlag } from '../../utils/common-flags.js'
import { ErrorHelper } from '../../utils/errors.js'

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
    '<%= config.bin %> <%= command.id %> --path ../feature-x --force',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --json',
    '<%= config.bin %> <%= command.id %> # Interactive selection',
  ]

  static flags = {
    path: pathFlag,

    force: forceFlag,

    json: jsonFlag,
  }

  /**
   * Interactively select worktrees to remove
   * @param worktrees - List of all worktrees (main worktree will be filtered out)
   * @returns Array of selected worktree paths
   */
  private async selectWorktreesInteractively(worktrees: WorktreeInfo[]): Promise<string[]> {
    const chalk = (await import('chalk')).default
    const inquirerModule = await import('inquirer')
    const inquirer = inquirerModule.default as any

    // Filter out main worktree (first entry)
    const removableWorktrees = worktrees.slice(1)

    if (removableWorktrees.length === 0) {
      this.error(chalk.yellow('No worktrees available to remove (only main worktree exists)'))
    }

    // Format choices for display
    const choices = removableWorktrees.map((wt) => {
      const branchDisplay = wt.branch || '(detached)'
      const prunableIndicator = wt.isPrunable ? ' 🗑️  (prunable)' : ''
      const label = `${branchDisplay} (${wt.path})${prunableIndicator}`

      return {
        name: label,
        value: wt.path,
      }
    })

    // Multi-select prompt
    const { selectedPaths } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedPaths',
        message: 'Select worktrees to remove (use spacebar to select, enter to confirm):',
        choices,
        validate: (answer: string[]) => {
          if (answer.length === 0) {
            return 'You must select at least one worktree'
          }
          return true
        },
      },
    ])

    return selectedPaths as string[]
  }

  /**
   * Confirm removal of selected worktrees
   * @param paths - Array of worktree paths to be removed
   * @returns True if user confirms, false otherwise
   */
  private async confirmRemoval(paths: string[]): Promise<boolean> {
    const chalk = (await import('chalk')).default
    const inquirerModule = await import('inquirer')
    const inquirer = inquirerModule.default as any

    this.log(chalk.yellow('\nWorktrees to be removed:'))
    for (const p of paths) {
      this.log(chalk.cyan(`  - ${p}`))
    }

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Remove ${paths.length} worktree${paths.length > 1 ? 's' : ''}?`,
        default: false,
      },
    ])

    return confirmed as boolean
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

      // 2. Get list of worktrees
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
              const inquirerModule = await import('inquirer')
              const inquirer = inquirerModule.default as any

              this.log(chalk.yellow(`\nWorktree '${worktreePath}' has uncommitted changes.`))

              const { confirmForce } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'confirmForce',
                  message: 'Do you want to force remove it?',
                  default: false,
                },
              ])

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

          results.push({
            path: worktreePath,
            success: true,
            branch: worktree.branch,
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
            this.log(`  ${chalk.cyan(result.path)}${result.branch ? ` (${result.branch})` : ''}`)
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
