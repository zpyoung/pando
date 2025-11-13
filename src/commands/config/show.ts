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

    try {
      // 1. Get current directory
      const cwd = process.cwd()

      // 2. Find git root (optional - if not in git repo, just use cwd)
      let gitRoot = cwd
      try {
        const { createGitHelper } = await import('../../utils/git.js')
        const gitHelper = createGitHelper()
        if (await gitHelper.isRepository()) {
          gitRoot = await gitHelper.getRepositoryRoot()
        }
      } catch {
        // Not a git repo, use cwd
      }

      // 3. Load configuration with source tracking
      const configWithSources = await configLoader.loadWithSources({
        cwd,
        gitRoot,
      })

      // 4. Format and display output
      if (flags.json) {
        // JSON output
        if (flags.sources) {
          this.log(JSON.stringify(configWithSources, null, 2))
        } else {
          this.log(JSON.stringify(configWithSources.config, null, 2))
        }
      } else {
        // Human-readable output
        await this.displayHumanReadable(configWithSources, flags.sources)
      }
    } catch (error) {
      this.error(`Failed to load configuration: ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Display configuration in human-readable format
   */
  private async displayHumanReadable(
    configWithSources: { config: any; sources: any },
    showSources: boolean
  ): Promise<void> {
    const chalk = (await import('chalk')).default
    const { config, sources } = configWithSources

    // Count unique sources (excluding DEFAULT)
    const uniqueSources = new Set(Object.values(sources).filter((s) => s !== 'default'))
    const sourceCount = uniqueSources.size + 1 // +1 for defaults

    // Title
    this.log(chalk.bold(`\nConfiguration (merged from ${sourceCount} source${sourceCount === 1 ? '' : 's'}):\n`))

    // [rsync] section
    this.log(chalk.cyan.bold('[rsync]'))
    this.log(
      `  enabled = ${chalk.yellow(config.rsync.enabled)}${
        showSources ? chalk.gray(` (${this.formatSource(sources['rsync.enabled'])})`) : ''
      }`
    )
    this.log(
      `  flags = ${chalk.yellow(JSON.stringify(config.rsync.flags))}${
        showSources ? chalk.gray(` (${this.formatSource(sources['rsync.flags'])})`) : ''
      }`
    )
    this.log(
      `  exclude = ${chalk.yellow(JSON.stringify(config.rsync.exclude))}${
        showSources ? chalk.gray(` (${this.formatSource(sources['rsync.exclude'])})`) : ''
      }`
    )

    this.log('')

    // [symlink] section
    this.log(chalk.cyan.bold('[symlink]'))
    this.log(
      `  patterns = ${chalk.yellow(JSON.stringify(config.symlink.patterns))}${
        showSources ? chalk.gray(` (${this.formatSource(sources['symlink.patterns'])})`) : ''
      }`
    )
    this.log(
      `  relative = ${chalk.yellow(config.symlink.relative)}${
        showSources ? chalk.gray(` (${this.formatSource(sources['symlink.relative'])})`) : ''
      }`
    )
    this.log(
      `  beforeRsync = ${chalk.yellow(config.symlink.beforeRsync)}${
        showSources ? chalk.gray(` (${this.formatSource(sources['symlink.beforeRsync'])})`) : ''
      }`
    )

    // Show sources summary if requested
    if (showSources) {
      this.log('')
      this.log(chalk.bold('Configuration sources (priority order):'))
      const sourcesList = Array.from(uniqueSources).sort()
      sourcesList.forEach((source, index) => {
        this.log(chalk.gray(`  ${index + 1}. ${this.formatSource(source as string)}`))
      })
      this.log(chalk.gray(`  ${sourcesList.length + 1}. defaults`))
    }

    this.log('')
  }

  /**
   * Format source name for display
   */
  private formatSource(source: string): string {
    const sourceMap: Record<string, string> = {
      'pando_toml': '.pando.toml',
      'pyproject_toml': 'pyproject.toml',
      'cargo_toml': 'Cargo.toml',
      'package_json': 'package.json',
      'deno_json': 'deno.json',
      'composer_json': 'composer.json',
      'global_config': '~/.config/pando/config.toml',
      'default': 'default',
      'cli_flag': 'CLI flag',
      'env_var': 'environment variable',
    }
    return sourceMap[source] || source
  }
}
