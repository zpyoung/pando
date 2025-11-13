import { Command, Flags } from '@oclif/core'
import { jsonFlag } from '../../utils/common-flags'

/**
 * Navigate to a git worktree
 *
 * Outputs commands or paths to help navigate to worktrees.
 * Can be used with shell evaluation for direct navigation.
 */
export default class NavigateWorktree extends Command {
  static description = 'Navigate to a git worktree'

  static examples = [
    '<%= config.bin %> <%= command.id %> --branch feature-x',
    '<%= config.bin %> <%= command.id %> --path ../feature-x',
    'cd $(%= config.bin %> <%= command.id %> --branch feature-x --output-path)',
  ]

  static flags = {
    branch: Flags.string({
      char: 'b',
      description: 'Branch name to navigate to',
      required: false,
      exclusive: ['path'],
    }),
    path: Flags.string({
      char: 'p',
      description: 'Worktree path to navigate to',
      required: false,
      exclusive: ['branch'],
    }),
    'output-path': Flags.boolean({
      description: 'Output only the path (useful for shell evaluation)',
      default: false,
    }),
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(NavigateWorktree)

    // Validate required flags
    if (!flags.branch && !flags.path) {
      this.error('Must specify either --branch or --path')
    }

    const { createGitHelper } = await import('../../utils/git.js')
    const git = createGitHelper()

    // Validate repository
    const isRepo = await git.isRepository()
    if (!isRepo) {
      this.error('Not a git repository')
    }

    try {
      let worktree = null

      // Find worktree by branch or path
      if (flags.branch) {
        worktree = await git.findWorktreeByBranch(flags.branch)
        if (!worktree) {
          this.error(`Worktree for branch '${flags.branch}' not found`)
        }
      } else if (flags.path) {
        // For path-based lookup, list all worktrees and find matching path
        const worktrees = await git.listWorktrees()
        worktree = worktrees.find(w => w.path === flags.path)
        if (!worktree) {
          this.error(`Worktree at path '${flags.path}' not found`)
        }
      }

      // Output based on flags
      if (flags['output-path']) {
        // Simple path output for shell evaluation
        this.log(worktree!.path)
      } else if (flags.json) {
        // JSON output
        this.log(JSON.stringify({
          path: worktree!.path,
          branch: worktree!.branch,
          commit: worktree!.commit,
          isPrunable: worktree!.isPrunable,
        }))
      } else {
        // Human-readable output
        const chalk = await import('chalk')
        this.log(chalk.default.green('✓ Worktree found'))
        this.log(`  Path: ${worktree!.path}`)
        this.log(`  Branch: ${worktree!.branch || 'detached'}`)
        this.log(`  Commit: ${worktree!.commit}`)
        this.log()
        this.log(chalk.default.blue('To navigate:'))
        this.log(`  cd ${worktree!.path}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.error(`Failed to navigate to worktree: ${errorMessage}`)
    }
  }
}
