import { Command, Flags } from '@oclif/core'
import { stringify as stringifyToml } from '@iarna/toml'
import fs from 'fs-extra'
import * as path from 'path'
import { simpleGit } from 'simple-git'
import { DEFAULT_CONFIG } from '../../config/schema.js'

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

    // Determine target directory
    let targetDir: string
    let filename: string

    if (flags.global) {
      // Global config: ~/.config/pando/
      const homeDir = process.env.HOME || process.env.USERPROFILE
      if (!homeDir) {
        this.error('Could not determine home directory')
      }
      targetDir = path.join(homeDir, '.config', 'pando')
      filename = 'config.toml'
    } else if (flags['git-root']) {
      // Git root config
      try {
        const git = simpleGit()

        const rootDir = await git.revparse(['--show-toplevel'])
        targetDir = rootDir.trim()
        filename = '.pando.toml'
      } catch {
        this.error('Not in a git repository. Use --global or run from a git repository.', {
          exit: 1,
        })
      }
    } else {
      // Current directory
      targetDir = process.cwd()
      filename = '.pando.toml'
    }

    const configPath = path.join(targetDir, filename)

    // Check if file exists
    const fileExists = await fs.pathExists(configPath)
    if (fileExists && !flags.force) {
      this.error(`Configuration file already exists: ${configPath}\nUse --force to overwrite`, {
        exit: 1,
      })
    }

    // Generate TOML content with helpful comments
    const tomlContent = this.generateTomlContent()

    // Write file
    try {
      // Create directory if needed
      await fs.ensureDir(targetDir)

      // Write TOML content
      await fs.writeFile(configPath, tomlContent, { mode: 0o644 })

      // Output success message
      this.log(`✓ Configuration file created: ${configPath}`)
      this.log('')
      this.log('Next steps:')
      this.log('  1. Edit the file to customize your settings')
      this.log('  2. Run `pando config show` to verify configuration')
      if (!flags.global) {
        this.log('  3. This config will be automatically discovered for this project')
      }
    } catch (error) {
      this.error(
        `Failed to create configuration file: ${error instanceof Error ? error.message : String(error)}`,
        { exit: 1 }
      )
    }
  }

  /**
   * Generate TOML content with comments
   */
  private generateTomlContent(): string {
    const toml = stringifyToml(
      DEFAULT_CONFIG as unknown as ReturnType<typeof import('@iarna/toml').parse>
    )

    // Add helpful header comment
    const header = `# Pando Configuration
#
# This file configures pando's behavior for managing git worktrees.
# See https://github.com/zpyoung/pando for documentation.

`

    // Add section comments
    const sections = [
      '# Rsync Configuration',
      '# Controls how files are copied from source tree to new worktrees',
      '',
    ].join('\n')

    const symlinkComment = [
      '',
      '# Symlink Configuration',
      '# Controls which files are symlinked instead of copied',
      '# Patterns support glob syntax (e.g., "*.json", ".env*")',
      '',
    ].join('\n')

    // Insert comments into TOML
    return header + sections + toml.replace('[symlink]', symlinkComment + '[symlink]')
  }
}
