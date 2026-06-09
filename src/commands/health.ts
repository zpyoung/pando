import { Command } from '@oclif/core'
import { createGitHelper } from '../utils/git.js'
import { jsonFlag } from '../utils/common-flags.js'
import { ErrorHelper } from '../utils/errors.js'

/**
 * Worktree health check status
 */
interface WorktreeHealth {
  path: string
  branch: string | null
  status: 'clean' | 'detached' | 'uncommitted' | 'behind' | 'gone' | 'error'
  message?: string
  details?: {
    uncommittedFiles?: number
    commitsBehind?: number
    targetBranch?: string
    remoteBranch?: string
  }
}

/**
 * Health check results
 */
interface HealthReport {
  worktrees: WorktreeHealth[]
  summary: {
    clean: number
    detached: number
    uncommitted: number
    behind: number
    gone: number
    errors: number
  }
}

/**
 * Show health status of all worktrees
 *
 * Displays worktree status including uncommitted changes,
 * branches behind upstream, and other health indicators.
 */
export default class Health extends Command {
  static description = 'Show health status of all worktrees'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Health)

    try {
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()

      if (!isRepo) {
        ErrorHelper.validation(
          this,
          'Not a git repository. Run this command from within a git repository.',
          flags.json as boolean | undefined
        )
        return
      }

      const worktrees = await gitHelper.listWorktrees()

      if (worktrees.length === 0) {
        if (flags.json) {
          this.log(
            JSON.stringify({
              worktrees: [],
              summary: { clean: 0, detached: 0, uncommitted: 0, behind: 0, gone: 0, errors: 0 },
            })
          )
        } else {
          const chalk = (await import('chalk')).default
          this.log(chalk.yellow('No worktrees found'))
        }
        return
      }

      const healthResults: WorktreeHealth[] = []

      for (const worktree of worktrees) {
        let health: WorktreeHealth = {
          path: worktree.path,
          branch: worktree.branch,
          status: 'clean',
        }

        // Skip detached HEAD worktrees for deep checks
        if (!worktree.branch) {
          health.status = 'detached'
          health.message = 'detached HEAD'
          healthResults.push(health)
          continue
        }

        // Check for uncommitted changes
        try {
          const hasChanges = await gitHelper.hasUncommittedChanges(worktree.path)
          if (hasChanges) {
            const modifiedFiles = await gitHelper.getUncommittedFileCount(worktree.path)

            health.status = 'uncommitted'
            health.message = `${modifiedFiles} file${modifiedFiles !== 1 ? 's' : ''} modified`
            health.details = {
              uncommittedFiles: modifiedFiles,
            }
            healthResults.push(health)
            continue
          }
        } catch {
          // Worktree directory might be missing
          health.status = 'error'
          health.message = 'cannot check status'
          healthResults.push(health)
          continue
        }

        // Check if branch is behind upstream
        try {
          // Full tracking ref, e.g. "origin/main". Null when no upstream.
          const trackingBranch = await gitHelper.getTrackingBranch(worktree.branch)
          if (trackingBranch) {
            const slashIndex = trackingBranch.indexOf('/')
            const remote = trackingBranch.slice(0, slashIndex)
            const branch = trackingBranch.slice(slashIndex + 1)

            const remoteExists = await gitHelper.remoteBranchExists(branch, remote)

            if (!remoteExists) {
              // Remote branch was deleted
              health.status = 'gone'
              health.message = 'remote branch deleted'
              health.details = {
                remoteBranch: trackingBranch,
              }
            } else {
              // Check how many commits behind. countCommitsBetween(from, to)
              // counts commits in `to` not in `from` (git rev-list --count
              // from..to), so to count commits the upstream has that the local
              // branch lacks we pass the local branch first, tracking ref second.
              const commitsBehind = await gitHelper.countCommitsBetween(
                worktree.branch,
                trackingBranch
              )
              if (commitsBehind && commitsBehind > 0) {
                health.status = 'behind'
                health.message = `${commitsBehind} commit${commitsBehind !== 1 ? 's' : ''} behind`
                health.details = {
                  commitsBehind,
                  targetBranch: trackingBranch,
                  remoteBranch: trackingBranch,
                }
              }
            }
          }
        } catch (error) {
          // A transient failure must not be reported as clean. Surface it as
          // an error so the user knows the remote check did not complete.
          const reason = error instanceof Error ? error.message : String(error)
          health.status = 'error'
          health.message = `remote check failed: ${reason}`
        }

        healthResults.push(health)
      }

      // Calculate summary
      const summary = {
        clean: healthResults.filter((h) => h.status === 'clean').length,
        detached: healthResults.filter((h) => h.status === 'detached').length,
        uncommitted: healthResults.filter((h) => h.status === 'uncommitted').length,
        behind: healthResults.filter((h) => h.status === 'behind').length,
        gone: healthResults.filter((h) => h.status === 'gone').length,
        errors: healthResults.filter((h) => h.status === 'error').length,
      }

      const report: HealthReport = {
        worktrees: healthResults,
        summary,
      }

      if (flags.json) {
        this.log(JSON.stringify(report, null, 2))
      } else {
        const chalk = (await import('chalk')).default

        // Print summary
        this.log(chalk.bold('Worktree Health Report'))
        this.log(chalk.bold('='.repeat(50)))
        this.log('')

        const sections: Array<{
          title: string
          items: WorktreeHealth[]
          color: (msg: string) => string
        }> = [
          {
            title: '🚨 Uncommitted changes:',
            items: healthResults.filter((h) => h.status === 'uncommitted'),
            color: chalk.red,
          },
          {
            title: '⚠️  Behind upstream:',
            items: healthResults.filter((h) => h.status === 'behind'),
            color: chalk.yellow,
          },
          {
            title: '👻 Remote branch gone:',
            items: healthResults.filter((h) => h.status === 'gone'),
            color: chalk.magenta,
          },
          {
            title: '❌ Errors:',
            items: healthResults.filter((h) => h.status === 'error'),
            color: chalk.redBright,
          },
          {
            title: '🔗 Detached HEAD:',
            items: healthResults.filter((h) => h.status === 'detached'),
            color: chalk.blue,
          },
          {
            title: '✅ All good:',
            items: healthResults.filter((h) => h.status === 'clean'),
            color: chalk.green,
          },
        ]

        for (const section of sections) {
          if (section.items.length > 0) {
            this.log(section.color(section.title))
            for (const item of section.items) {
              this.log(`  ${chalk.cyan(item.path)}`)
              if (item.branch) {
                this.log(`    ${chalk.gray(`Branch: ${item.branch}`)}`)
              }
              if (item.message) {
                this.log(`    ${section.color(item.message)}`)
              }
              if (item.details?.remoteBranch) {
                this.log(`    ${chalk.gray(`Remote: ${item.details.remoteBranch}`)}`)
              }
              this.log('')
            }
          }
        }

        this.log(
          chalk.gray(
            `Total: ${healthResults.length} worktree${healthResults.length !== 1 ? 's' : ''}`
          )
        )
      }
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        'Failed to check worktree health',
        flags.json as boolean | undefined
      )
    }
  }
}
