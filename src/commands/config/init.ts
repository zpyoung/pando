import { Command, Flags } from '@oclif/core'
import { stringify as stringifyToml } from '@iarna/toml'
import * as fs from 'fs-extra'
import * as path from 'path'
import { DEFAULT_CONFIG } from '../../config/schema'

/**
 * Initialize pando configuration
 *
 * Creates a .pando.toml file with default configuration.
 * Useful for getting started or documenting available options.
 */
export default class ConfigInit extends Command {
  static description = 'Generate a .pando.toml configuration file with defaults'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --global',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing .pando.toml',
      default: false,
    }),
    global: Flags.boolean({
      char: 'g',
      description: 'Create global config in ~/.config/pando/config.toml',
      default: false,
    }),
    'git-root': Flags.boolean({
      description: 'Create config at git repository root',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigInit)

    // TODO: Determine target directory
    // - If --global: ~/.config/pando/
    // - If --git-root: git repository root
    // - Otherwise: current directory

    // TODO: Determine filename
    // - Global: config.toml
    // - Project: .pando.toml

    // TODO: Check if file exists
    // - If exists and not --force: Error with helpful message
    // - If exists and --force: Continue

    // TODO: Generate TOML content
    // - Use DEFAULT_CONFIG from schema
    // - Convert to TOML with stringifyToml
    // - Add comments explaining each section

    // TODO: Write file
    // - Create directory if needed (especially for global)
    // - Write TOML content
    // - Set appropriate permissions

    // TODO: Output success message
    // - Show path where config was created
    // - Provide next steps (edit file, see config:show)
    // - If project config, mention it will be discovered automatically

    this.log('TODO: Implement config:init command')
    this.log(`Force: ${flags.force}`)
    this.log(`Global: ${flags.global}`)
    this.log(`Git root: ${flags['git-root']}`)
  }
}
