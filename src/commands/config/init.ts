import { Command, Flags } from '@oclif/core'
import { stringify as stringifyToml } from '@iarna/toml'
import fs from 'fs-extra'
import * as path from 'path'
import { simpleGit } from 'simple-git'
import { DEFAULT_CONFIG } from '../../config/schema.js'
import { ErrorHelper } from '../../utils/errors.js'
import { jsonFlag } from '../../utils/common-flags.js'

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
    json: jsonFlag,
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
        ErrorHelper.validation(this, 'Could not determine home directory', flags.json)
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
        ErrorHelper.validation(
          this,
          'Not in a git repository. Use --global or run from a git repository.',
          flags.json
        )
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
      ErrorHelper.validation(
        this,
        `Configuration file already exists: ${configPath}\nUse --force to overwrite`,
        flags.json
      )
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
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              status: 'success',
              path: configPath,
              type: flags.global ? 'global' : 'local',
            },
            null,
            2
          )
        )
      } else {
        this.log(`✓ Configuration file created: ${configPath}`)
        this.log('')
        this.log('Next steps:')
        this.log('  1. Edit the file to customize your settings')
        this.log('  2. Run `pando config show` to verify configuration')
        if (!flags.global) {
          this.log('  3. This config will be automatically discovered for this project')
        }
      }
    } catch (error) {
      ErrorHelper.operation(this, error as Error, 'Failed to create configuration file', flags.json)
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

    const worktreeComment = [
      '',
      '# Worktree Configuration',
      '# Controls default behavior for worktree operations',
      '# defaultPath - Default parent directory for new worktrees',
      '#   Relative paths resolve from git root, branch names are auto-appended',
      '#   Example: "../worktrees" with --branch feat/login → ../worktrees/feat_login',
      '# rebaseOnAdd - Automatically rebase existing branches onto source when adding worktree',
      '#   Set to false to disable automatic rebase, or use --no-rebase flag',
      '',
    ].join('\n')

    // Insert comments into TOML
    let result = header + sections + toml
    result = result.replace('[symlink]', symlinkComment + '[symlink]')
    result = result.replace('[worktree]', worktreeComment + '[worktree]')
    return result
  }
}
