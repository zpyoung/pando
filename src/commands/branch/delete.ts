import { Command, Flags } from '@oclif/core'
import { createGitHelper } from '../../utils/git.js'
import { jsonFlag, forceFlag } from '../../utils/common-flags'

/**
 * Delete a git branch
 *
 * Deletes a branch from the repository.
 * Includes safety checks to prevent deleting unmerged branches.
 */
export default class DeleteBranch extends Command {
  static description = 'Delete a git branch'

  static examples = [
    '<%= config.bin %> <%= command.id %> --name feature-x',
    '<%= config.bin %> <%= command.id %> --name feature-x --force',
    '<%= config.bin %> <%= command.id %> --name feature-x --remove-worktree',
  ]

  static flags = {
    name: Flags.string({
      char: 'n',
      description: 'Name of the branch to delete',
      required: true,
    }),
    force: forceFlag,
    'remove-worktree': Flags.boolean({
      char: 'w',
      description: 'Also remove associated worktree if exists',
      default: false,
    }),
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DeleteBranch)

    try {
      // 1. Validate the repository is a git repo
      const git = createGitHelper()
      const isRepo = await git.isRepository()

      if (!isRepo) {
        this.error('Not a git repository')
      }

      // 2. Check if branch exists
      const branchExists = await git.branchExists(flags.name)

      if (!branchExists) {
        this.error(`Branch '${flags.name}' does not exist`)
      }

      // 3. Check if branch is currently checked out
      const currentBranch = await git.getCurrentBranch()

      if (currentBranch === flags.name) {
        this.error(`Cannot delete the currently checked out branch '${flags.name}'`)
      }

      // 4. Check if branch has unmerged changes (unless --force)
      if (!flags.force) {
        const isMerged = await git.isBranchMerged(flags.name)

        if (!isMerged) {
          this.error(
            `Branch '${flags.name}' is not fully merged. Use --force to delete anyway.`
          )
        }
      }

      // 5. If --remove-worktree, find and remove associated worktree
      let worktreeRemoved = false
      let worktreePath: string | null = null

      if (flags['remove-worktree']) {
        const worktree = await git.findWorktreeByBranch(flags.name)

        if (worktree) {
          worktreePath = worktree.path
          // Check for uncommitted changes in worktree
          const hasUncommitted = await git.hasUncommittedChanges(worktree.path)

          if (hasUncommitted && !flags.force) {
            this.error(
              `Worktree at '${worktree.path}' has uncommitted changes. Use --force to remove anyway.`
            )
          }

          await git.removeWorktree(worktree.path, flags.force)
          worktreeRemoved = true
        }
      }

      // 6. Delete the branch
      await git.deleteBranch(flags.name, flags.force)

      // 7. Format output based on --json flag
      if (flags.json) {
        const result = {
          status: 'success',
          branch: {
            name: flags.name,
            deleted: true,
            forced: flags.force,
          },
          ...(worktreeRemoved && {
            worktree: {
              path: worktreePath,
              removed: true,
            },
          }),
        }
        this.log(JSON.stringify(result, null, 2))
      } else {
        const chalk = (await import('chalk')).default
        this.log(chalk.green(`✓ Deleted branch '${flags.name}'`))

        if (flags.force) {
          this.log(chalk.yellow(`  (forced deletion)`))
        }

        if (worktreeRemoved) {
          this.log(chalk.green(`✓ Removed worktree`))
          this.log(`  ${chalk.dim('Path:')} ${worktreePath}`)
        }
      }
    } catch (error) {
      // 8. Handle errors appropriately
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              status: 'error',
              error: errorMessage,
            },
            null,
            2
          )
        )
        this.exit(1)
      } else {
        this.error(errorMessage)
      }
    }
  }
}
