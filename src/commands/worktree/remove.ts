import { Command, Flags } from '@oclif/core'
import * as path from 'node:path'
import { createGitHelper } from '../../utils/git.js'
import { jsonFlag, forceFlag } from '../../utils/common-flags'

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
  ]

  static flags = {
    path: Flags.string({
      char: 'p',
      description: 'Path to the worktree to remove',
      required: true,
    }),
    force: forceFlag,
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(RemoveWorktree)

    try {
      // 1. Validate the repository is a git repo
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()

      if (!isRepo) {
        if (flags.json) {
          this.log(JSON.stringify({
            success: false,
            error: 'Not a git repository',
          }))
        } else {
          this.error('Not a git repository')
        }
        return
      }

      // 2. Check if worktree exists
      const worktrees = await gitHelper.listWorktrees()
      const absolutePath = path.resolve(flags.path)
      const worktree = worktrees.find(w =>
        path.resolve(w.path) === absolutePath || w.path === flags.path
      )

      if (!worktree) {
        if (flags.json) {
          this.log(JSON.stringify({
            success: false,
            error: `Worktree not found at ${flags.path}`,
          }))
        } else {
          this.error(`Worktree not found at ${flags.path}`)
        }
        return
      }

      // 3. Check for uncommitted changes (unless --force)
      let hasUncommitted = false
      if (!flags.force) {
        hasUncommitted = await gitHelper.hasUncommittedChanges(worktree.path)

        if (hasUncommitted) {
          if (flags.json) {
            this.log(JSON.stringify({
              success: false,
              error: 'Worktree has uncommitted changes. Use --force to remove anyway.',
              path: worktree.path,
              hasUncommittedChanges: true,
            }))
          } else {
            const chalk = (await import('chalk')).default
            this.error(
              chalk.red('Worktree has uncommitted changes.') + '\n' +
              chalk.yellow(`Use ${chalk.bold('--force')} to remove anyway.`)
            )
          }
          return
        }
      }

      // 4. Execute git worktree remove command
      await gitHelper.removeWorktree(worktree.path, flags.force)

      // 5. Format output based on --json flag
      if (flags.json) {
        this.log(JSON.stringify({
          success: true,
          path: worktree.path,
          branch: worktree.branch,
          forced: flags.force,
        }))
      } else {
        const chalk = (await import('chalk')).default
        this.log(chalk.green('✓ Worktree removed successfully'))
        this.log(`  Path: ${chalk.cyan(worktree.path)}`)
        if (worktree.branch) {
          this.log(`  Branch: ${chalk.cyan(worktree.branch)}`)
        }
        if (flags.force) {
          this.log(chalk.yellow('  ⚠ Forced removal (uncommitted changes may have been lost)'))
        }
      }
    } catch (error) {
      // 6. Handle errors appropriately
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (flags.json) {
        this.log(JSON.stringify({
          success: false,
          error: errorMessage,
        }))
      } else {
        const chalk = (await import('chalk')).default
        this.error(chalk.red(`Failed to remove worktree: ${errorMessage}`))
      }
    }
  }
}
