import { Command, Flags } from '@oclif/core'
import { configLoader } from '../../config/loader'

/**
 * Show merged configuration
 *
 * Displays the final configuration after merging all sources.
 * Useful for debugging configuration issues and understanding
 * which settings are active.
 */
export default class ConfigShow extends Command {
  static description = 'Display merged configuration from all sources'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --sources',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    sources: Flags.boolean({
      char: 's',
      description: 'Show where each setting comes from',
      default: false,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output in JSON format',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigShow)

    // TODO: Load configuration
    // - Get current directory
    // - Find git root
    // - Load config with configLoader.loadWithSources()

    // TODO: Format output
    // - If --json: JSON.stringify with pretty printing
    // - If --sources: Show each setting with its source
    // - Otherwise: Show clean config in human-readable format

    // TODO: Display configuration
    // - Use chalk for colored output (non-JSON)
    // - Highlight sources in different colors
    // - Show sections clearly (rsync, symlink)

    // Example output (non-JSON, with sources):
    // Configuration (merged from 3 sources):
    //
    // [rsync]
    // enabled = true (default)
    // flags = ["--archive", "--exclude", ".git"] (default)
    // exclude = ["*.log"] (.pando.toml)
    //
    // [symlink]
    // patterns = ["package.json", "pnpm-lock.yaml"] (package.json)
    // relative = true (default)
    // beforeRsync = true (default)
    //
    // Configuration sources (priority order):
    // 1. .pando.toml
    // 2. package.json
    // 3. defaults

    this.log('TODO: Implement config:show command')
    this.log(`Sources: ${flags.sources}`)
    this.log(`JSON: ${flags.json}`)
  }
}
