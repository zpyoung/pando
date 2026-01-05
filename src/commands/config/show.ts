import { Command, Flags } from '@oclif/core'
import { configLoader, discoverConfigFiles, hasProjectConfigErrors } from '../../config/loader.js'
import type { ConfigFile, ConfigLoadResult } from '../../config/schema.js'
import { jsonFlag } from '../../utils/common-flags.js'
import { ErrorHelper } from '../../utils/errors.js'

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

    json: jsonFlag,
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

      // 3. Discover config files
      const configFiles = await discoverConfigFiles(cwd, gitRoot)

      // 4. Load configuration with source tracking (doesn't throw on errors)
      const result = await configLoader.loadWithSources({
        cwd,
        gitRoot,
      })

      // 5. Format and display output
      if (flags.json) {
        this.outputJson(result, configFiles, flags.sources)
      } else {
        await this.displayHumanReadable(result, configFiles, flags.sources)
      }

      // 6. Set exit code if there are project config errors
      // (use process.exitCode instead of this.exit() to avoid interrupting output)
      if (hasProjectConfigErrors(result)) {
        process.exitCode = 1
      }
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        'Failed to load configuration',
        flags.json as boolean | undefined
      )
    }
  }

  /**
   * Output JSON format with errors
   */
  private outputJson(
    result: ConfigLoadResult,
    configFiles: ConfigFile[],
    showSources: boolean
  ): void {
    const filesToInclude = showSources ? configFiles : configFiles.filter((f) => f.exists)

    // Build output object
    const output: Record<string, unknown> = showSources
      ? { config: result.config, sources: result.sources }
      : { ...result.config }

    // Always include files
    output.files = filesToInclude

    // Include errors if any exist
    if (result.errors.length > 0) {
      output.errors = result.errors.map((e) => ({
        path: e.path,
        source: e.source,
        message: e.message,
        isProjectConfig: e.isProjectConfig,
        ...(e.line !== undefined && { line: e.line }),
        ...(e.column !== undefined && { column: e.column }),
      }))
    }

    this.log(JSON.stringify(output, null, 2))
  }

  /**
   * Display configuration in human-readable format
   */
  private async displayHumanReadable(
    result: ConfigLoadResult,
    configFiles: ConfigFile[],
    showSources: boolean
  ): Promise<void> {
    const chalk = (await import('chalk')).default
    const { config, sources, errors } = result

    // Display errors FIRST if any exist
    if (errors.length > 0) {
      this.log(chalk.red.bold('\nConfiguration Errors:\n'))

      for (const error of errors) {
        const typeLabel = error.isProjectConfig ? chalk.red('[PROJECT]') : chalk.yellow('[GLOBAL]')

        const location =
          error.line !== undefined
            ? ` (line ${error.line}${error.column !== undefined ? `, column ${error.column}` : ''})`
            : ''

        this.log(`${typeLabel} ${chalk.cyan(error.path)}${location}`)
        this.log(chalk.red(`  Error: ${error.message}`))
        this.log('')
      }

      if (hasProjectConfigErrors(result)) {
        this.log(
          chalk.yellow(
            'Note: Project configuration errors will cause other pando commands to fail.\n' +
              'Please fix the errors above or remove the invalid configuration files.\n'
          )
        )
      }
    }

    // Count unique sources (excluding DEFAULT)
    const uniqueSources = new Set(
      Object.values(sources).filter((s) => String(s).toLowerCase() !== 'default')
    )
    const sourceCount = uniqueSources.size + 1 // +1 for defaults

    // Title
    this.log(
      chalk.bold(
        `Configuration (merged from ${sourceCount} source${sourceCount === 1 ? '' : 's'}):\n`
      )
    )

    // Config files section
    if (showSources) {
      // Show all searched locations with status
      this.log(chalk.bold('Config files:'))
      for (const file of configFiles) {
        // Check if this file had an error
        const hasError = errors.some((e) => e.path === file.path)
        if (hasError) {
          this.log(chalk.red(`  ✗ ${file.path} (parse error)`))
        } else if (file.exists) {
          this.log(chalk.green(`  ✓ ${file.path}`))
        } else {
          this.log(chalk.gray(`  ✗ ${file.path} (not found)`))
        }
      }
    } else {
      // Show only existing files (including those with errors)
      const existingFiles = configFiles.filter((f) => f.exists)
      if (existingFiles.length > 0) {
        this.log(chalk.bold('Config files found:'))
        for (const file of existingFiles) {
          const hasError = errors.some((e) => e.path === file.path)
          if (hasError) {
            this.log(chalk.red(`  ${file.path} (parse error)`))
          } else {
            this.log(chalk.green(`  ${file.path}`))
          }
        }
      } else {
        this.log(chalk.gray('No config files found (using defaults)'))
      }
    }
    this.log('')

    // [rsync] section
    const rsyncConfig = config.rsync as unknown as Record<string, unknown>
    this.log(chalk.cyan.bold('[rsync]'))
    this.log(
      `  enabled = ${chalk.yellow(String(rsyncConfig.enabled))}${
        showSources ? chalk.gray(` (${this.formatSource(String(sources['rsync.enabled']))})`) : ''
      }`
    )
    this.log(
      `  flags = ${chalk.yellow(JSON.stringify(rsyncConfig.flags))}${
        showSources ? chalk.gray(` (${this.formatSource(String(sources['rsync.flags']))})`) : ''
      }`
    )
    this.log(
      `  exclude = ${chalk.yellow(JSON.stringify(rsyncConfig.exclude))}${
        showSources ? chalk.gray(` (${this.formatSource(String(sources['rsync.exclude']))})`) : ''
      }`
    )

    this.log('')

    // [symlink] section
    const symlinkConfig = config.symlink as unknown as Record<string, unknown>
    this.log(chalk.cyan.bold('[symlink]'))
    this.log(
      `  patterns = ${chalk.yellow(JSON.stringify(symlinkConfig.patterns))}${
        showSources
          ? chalk.gray(` (${this.formatSource(String(sources['symlink.patterns']))})`)
          : ''
      }`
    )
    this.log(
      `  relative = ${chalk.yellow(String(symlinkConfig.relative))}${
        showSources
          ? chalk.gray(` (${this.formatSource(String(sources['symlink.relative']))})`)
          : ''
      }`
    )
    this.log(
      `  beforeRsync = ${chalk.yellow(String(symlinkConfig.beforeRsync))}${
        showSources
          ? chalk.gray(` (${this.formatSource(String(sources['symlink.beforeRsync']))})`)
          : ''
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
      pando_toml: '.pando.toml',
      pyproject_toml: 'pyproject.toml',
      cargo_toml: 'Cargo.toml',
      package_json: 'package.json',
      deno_json: 'deno.json',
      composer_json: 'composer.json',
      global_config: '~/.config/pando/config.toml',
      default: 'default',
      cli_flag: 'CLI flag',
      env_var: 'environment variable',
    }
    return sourceMap[source] || source
  }
}
