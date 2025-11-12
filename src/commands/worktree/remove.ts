import { Command, Flags } from '@oclif/core'

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
    force: Flags.boolean({
      char: 'f',
      description: 'Force removal even with uncommitted changes',
      default: false,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output result in JSON format',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(RemoveWorktree)

    // TODO: Implement worktree remove logic
    // 1. Validate the repository is a git repo
    // 2. Check if worktree exists
    // 3. Check for uncommitted changes (unless --force)
    // 4. Prompt for confirmation if not using --force
    // 5. Execute git worktree remove command
    // 6. Handle errors appropriately
    // 7. Format output based on --json flag

    this.log(`TODO: Remove worktree at ${flags.path}`)
    if (flags.force) {
      this.log('TODO: Force removal (skip safety checks)')
    }
    if (flags.json) {
      this.log('TODO: Output as JSON')
    }
  }
}
