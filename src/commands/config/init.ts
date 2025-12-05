import { Command, Flags } from '@oclif/core'
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'
import fs from 'fs-extra'
import * as path from 'path'
import { simpleGit } from 'simple-git'
import { DEFAULT_CONFIG, PandoConfig, PartialPandoConfig } from '../../config/schema.js'
import { ErrorHelper } from '../../utils/errors.js'
import { jsonFlag } from '../../utils/common-flags.js'

/**
 * Represents a setting that was added during merge
 */
interface AddedSetting {
  path: string
  value: unknown
}

/**
 * Result of merging configurations
 */
interface MergeResult {
  merged: PandoConfig
  added: AddedSetting[]
}

/**
 * Initialize pando configuration
 *
 * Creates a .pando.toml file with default configuration.
 * If file exists, intelligently merges missing defaults.
 */
export default class ConfigInit extends Command {
  static description = 'Generate a .pando.toml configuration file with defaults'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --global',
    '<%= config.bin %> <%= command.id %> --no-merge',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing .pando.toml (ignores --merge)',
      default: false,
    }),
    merge: Flags.boolean({
      char: 'm',
      description: 'Merge missing defaults into existing config (default when file exists)',
      default: true,
      allowNo: true,
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
        return // TypeScript doesn't know validation throws
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

    const configPath = path.join(targetDir!, filename)

    // Check if file exists
    const fileExists = await fs.pathExists(configPath)

    // Handle existing file scenarios
    if (fileExists) {
      if (flags.force) {
        // --force: overwrite entirely
        await this.writeNewConfig(configPath, flags)
      } else if (flags.merge) {
        // --merge (default): merge missing defaults
        await this.mergeExistingConfig(configPath, flags)
      } else {
        // --no-merge: error
        ErrorHelper.validation(
          this,
          `Configuration file already exists: ${configPath}\nUse --force to overwrite or --merge to add missing defaults`,
          flags.json
        )
      }
    } else {
      // New file: write with defaults
      await this.writeNewConfig(configPath, flags)
    }
  }

  /**
   * Write a new config file with all defaults
   */
  private async writeNewConfig(
    configPath: string,
    flags: { json: boolean; global: boolean; force: boolean }
  ): Promise<void> {
    const targetDir = path.dirname(configPath)

    // Generate TOML content with helpful comments
    const tomlContent = this.generateTomlContent()

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
              action: flags.force ? 'overwritten' : 'created',
              path: configPath,
              type: flags.global ? 'global' : 'local',
            },
            null,
            2
          )
        )
      } else {
        const action = flags.force ? 'overwritten' : 'created'
        this.log(`✓ Configuration file ${action}: ${configPath}`)
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
   * Merge missing defaults into an existing config file
   */
  private async mergeExistingConfig(
    configPath: string,
    flags: { json: boolean; global: boolean }
  ): Promise<void> {
    try {
      // Read and parse existing config
      const existingContent = await fs.readFile(configPath, 'utf-8')
      let existingConfig: PartialPandoConfig

      try {
        existingConfig = parseToml(existingContent) as PartialPandoConfig
      } catch (parseError) {
        ErrorHelper.operation(
          this,
          parseError as Error,
          'Failed to parse existing configuration file',
          flags.json
        )
        return
      }

      // Merge with defaults
      const mergeResult = this.mergeWithDefaults(existingConfig)

      // If nothing was added, inform user
      if (mergeResult.added.length === 0) {
        if (flags.json) {
          this.log(
            JSON.stringify(
              {
                status: 'success',
                action: 'unchanged',
                path: configPath,
                type: flags.global ? 'global' : 'local',
                message: 'Configuration is already up to date',
                added: [],
              },
              null,
              2
            )
          )
        } else {
          this.log(`✓ Configuration is already up to date: ${configPath}`)
          this.log('  No missing settings to add.')
        }
        return
      }

      // Generate new TOML content with merged config
      const tomlContent = this.generateTomlContent(mergeResult.merged)

      // Write updated content
      await fs.writeFile(configPath, tomlContent, { mode: 0o644 })

      // Output success message
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              status: 'success',
              action: 'merged',
              path: configPath,
              type: flags.global ? 'global' : 'local',
              added: mergeResult.added,
              addedCount: mergeResult.added.length,
            },
            null,
            2
          )
        )
      } else {
        this.log(`✓ Configuration updated: ${configPath}`)
        this.log('')
        this.log(`Added ${mergeResult.added.length} missing setting(s):`)
        for (const setting of mergeResult.added) {
          const valueStr =
            typeof setting.value === 'object'
              ? JSON.stringify(setting.value)
              : String(setting.value)
          this.log(`  • ${setting.path} = ${valueStr}`)
        }
      }
    } catch (error) {
      ErrorHelper.operation(this, error as Error, 'Failed to merge configuration file', flags.json)
    }
  }

  /**
   * Merge existing partial config with defaults, tracking what was added
   */
  private mergeWithDefaults(existing: PartialPandoConfig): MergeResult {
    const added: AddedSetting[] = []
    const merged: PandoConfig = {
      rsync: { ...DEFAULT_CONFIG.rsync },
      symlink: { ...DEFAULT_CONFIG.symlink },
      worktree: { ...DEFAULT_CONFIG.worktree },
    }

    // Merge rsync section
    if (existing.rsync) {
      if (existing.rsync.enabled !== undefined) {
        merged.rsync.enabled = existing.rsync.enabled
      } else {
        added.push({ path: 'rsync.enabled', value: DEFAULT_CONFIG.rsync.enabled })
      }

      if (existing.rsync.flags !== undefined) {
        merged.rsync.flags = existing.rsync.flags
      } else {
        added.push({ path: 'rsync.flags', value: DEFAULT_CONFIG.rsync.flags })
      }

      if (existing.rsync.exclude !== undefined) {
        merged.rsync.exclude = existing.rsync.exclude
      } else {
        added.push({ path: 'rsync.exclude', value: DEFAULT_CONFIG.rsync.exclude })
      }
    } else {
      added.push({ path: 'rsync', value: DEFAULT_CONFIG.rsync })
    }

    // Merge symlink section
    if (existing.symlink) {
      if (existing.symlink.patterns !== undefined) {
        merged.symlink.patterns = existing.symlink.patterns
      } else {
        added.push({ path: 'symlink.patterns', value: DEFAULT_CONFIG.symlink.patterns })
      }

      if (existing.symlink.relative !== undefined) {
        merged.symlink.relative = existing.symlink.relative
      } else {
        added.push({ path: 'symlink.relative', value: DEFAULT_CONFIG.symlink.relative })
      }

      if (existing.symlink.beforeRsync !== undefined) {
        merged.symlink.beforeRsync = existing.symlink.beforeRsync
      } else {
        added.push({ path: 'symlink.beforeRsync', value: DEFAULT_CONFIG.symlink.beforeRsync })
      }
    } else {
      added.push({ path: 'symlink', value: DEFAULT_CONFIG.symlink })
    }

    // Merge worktree section
    if (existing.worktree) {
      // defaultPath is optional, only add if not present and has a default
      if (existing.worktree.defaultPath !== undefined) {
        merged.worktree.defaultPath = existing.worktree.defaultPath
      }
      // Note: defaultPath has no default value, so we don't add it

      if (existing.worktree.rebaseOnAdd !== undefined) {
        merged.worktree.rebaseOnAdd = existing.worktree.rebaseOnAdd
      } else {
        added.push({ path: 'worktree.rebaseOnAdd', value: DEFAULT_CONFIG.worktree.rebaseOnAdd })
      }

      if (existing.worktree.deleteBranchOnRemove !== undefined) {
        merged.worktree.deleteBranchOnRemove = existing.worktree.deleteBranchOnRemove
      } else {
        added.push({
          path: 'worktree.deleteBranchOnRemove',
          value: DEFAULT_CONFIG.worktree.deleteBranchOnRemove,
        })
      }

      if (existing.worktree.useProjectSubfolder !== undefined) {
        merged.worktree.useProjectSubfolder = existing.worktree.useProjectSubfolder
      } else {
        added.push({
          path: 'worktree.useProjectSubfolder',
          value: DEFAULT_CONFIG.worktree.useProjectSubfolder,
        })
      }
    } else {
      added.push({ path: 'worktree', value: DEFAULT_CONFIG.worktree })
    }

    return { merged, added }
  }

  /**
   * Generate TOML content with comments
   */
  private generateTomlContent(config: PandoConfig = DEFAULT_CONFIG): string {
    const toml = stringifyToml(config as unknown as ReturnType<typeof import('@iarna/toml').parse>)

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
      '# useProjectSubfolder - Create worktrees in project-specific subfolders',
      '#   true: ../worktrees/projectName/branchName',
      '#   false: ../worktrees/branchName (default)',
      '# rebaseOnAdd - Automatically rebase existing branches onto source when adding worktree',
      '#   Set to false to disable automatic rebase, or use --no-rebase flag',
      '# deleteBranchOnRemove - Delete branch when removing worktree',
      '#   none: Do not delete branches (use --keep-branch flag)',
      '#   local: Delete local branch only (default)',
      '#   remote: Delete both local and remote branches',
      '',
    ].join('\n')

    // Insert comments into TOML
    let result = header + sections + toml
    result = result.replace('[symlink]', symlinkComment + '[symlink]')
    result = result.replace('[worktree]', worktreeComment + '[worktree]')
    return result
  }
}
