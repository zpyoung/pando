import { Command, Flags } from '@oclif/core'
import { createGitHelper } from '../../utils/git.js'
import { jsonFlag } from '../../utils/common-flags.js'
import { ErrorHelper } from '../../utils/errors.js'

/**
 * List all git worktrees
 *
 * Displays information about all worktrees associated with
 * the current repository, including paths, branches, and commit hashes.
 */
export default class ListWorktree extends Command {
  static description = 'List all git worktrees'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --verbose',
  ]

  static flags = {
    json: jsonFlag,
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed information',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ListWorktree)

    try {
      // 1. Validate the repository is a git repo
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()

      if (!isRepo) {
        ErrorHelper.validation(
          this,
          'Not a git repository. Run this command from within a git repository.',
          flags.json as boolean | undefined
        )
      }

      // 2. Execute git worktree list command and parse output
      const worktrees = await gitHelper.listWorktrees()

      // 3. Handle edge case: no worktrees
      if (worktrees.length === 0) {
        if (flags.json) {
          this.log(JSON.stringify({ worktrees: [] }))
        } else {
          const chalk = (await import('chalk')).default
          this.log(chalk.yellow('No worktrees found'))
        }
        return
      }

      // 4-5. Format and output based on flags
      if (flags.json) {
        // JSON output
        this.log(JSON.stringify({ worktrees }, null, 2))
      } else {
        // Human-readable output with chalk
        const chalk = (await import('chalk')).default
        this.log(chalk.bold(`Found ${worktrees.length} worktree(s):\n`))

        for (const worktree of worktrees) {
          // Path (always show)
          this.log(chalk.cyan(`  ${worktree.path}`))

          // Branch
          if (worktree.branch) {
            this.log(chalk.green(`    Branch: ${worktree.branch}`))
          } else {
            this.log(chalk.yellow(`    Branch: (detached HEAD)`))
          }

          // Verbose mode: show commit hash and prunable status
          if (flags.verbose) {
            this.log(chalk.gray(`    Commit: ${worktree.commit}`))
            if (worktree.isPrunable) {
              this.log(chalk.red(`    Status: prunable (directory deleted)`))
            }
          }

          // Show prunable warning even in non-verbose mode
          if (!flags.verbose && worktree.isPrunable) {
            this.log(chalk.red(`    ⚠ Prunable (directory deleted)`))
          }

          this.log('') // Empty line between entries
        }
      }
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        'Failed to list worktrees',
        flags.json as boolean | undefined
      )
    }
  }
}
