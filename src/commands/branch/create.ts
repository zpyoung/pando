import { Command, Flags } from '@oclif/core'
import { createGitHelper } from '../../utils/git.js'

/**
 * Create a new git branch
 *
 * Creates a new branch in the repository.
 * Can optionally create a worktree for the branch immediately.
 */
export default class CreateBranch extends Command {
  static description = 'Create a new git branch'

  static examples = [
    '<%= config.bin %> <%= command.id %> --name feature-x',
    '<%= config.bin %> <%= command.id %> --name feature-x --from main',
    '<%= config.bin %> <%= command.id %> --name feature-x --worktree ../feature-x',
  ]

  static flags = {
    name: Flags.string({
      char: 'n',
      description: 'Name of the branch to create',
      required: true,
    }),
    from: Flags.string({
      char: 'f',
      description: 'Base branch or commit to create from',
      default: 'main',
    }),
    worktree: Flags.string({
      char: 'w',
      description: 'Automatically create a worktree at this path',
      required: false,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output result in JSON format',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(CreateBranch)

    try {
      // 1. Validate the repository is a git repo
      const git = createGitHelper()
      const isRepo = await git.isRepository()

      if (!isRepo) {
        this.error('Not a git repository')
      }

      // 2. Check if branch already exists
      const branchExists = await git.branchExists(flags.name)

      if (branchExists) {
        this.error(`Branch '${flags.name}' already exists`)
      }

      // 3. Validate the base branch/commit exists
      try {
        await git.branchExists(flags.from)
        // Note: branchExists checks refs/heads/, so this validates branch
        // For commit hashes, git will validate during branch creation
      } catch (error) {
        // Continue - will be validated during branch creation
      }

      // 4. Create the branch
      const branchInfo = await git.createBranch(flags.name, flags.from)

      // 5. If --worktree specified, create worktree for the branch
      let worktreeInfo = null
      if (flags.worktree) {
        worktreeInfo = await git.addWorktree(flags.worktree, {
          branch: flags.name,
        })
      }

      // 6. Format output based on --json flag
      if (flags.json) {
        const result = {
          status: 'success',
          branch: {
            name: branchInfo.name,
            commit: branchInfo.commit,
            from: flags.from,
          },
          ...(worktreeInfo && {
            worktree: {
              path: worktreeInfo.path,
              branch: worktreeInfo.branch,
              commit: worktreeInfo.commit,
            },
          }),
        }
        this.log(JSON.stringify(result, null, 2))
      } else {
        const chalk = (await import('chalk')).default
        this.log(chalk.green(`✓ Created branch '${branchInfo.name}'`))
        this.log(`  ${chalk.dim('From:')} ${flags.from}`)
        this.log(`  ${chalk.dim('Commit:')} ${branchInfo.commit.substring(0, 8)}`)

        if (worktreeInfo) {
          this.log(chalk.green(`✓ Created worktree`))
          this.log(`  ${chalk.dim('Path:')} ${worktreeInfo.path}`)
        }
      }
    } catch (error) {
      // 7. Handle errors appropriately
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
