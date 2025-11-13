import { parse as parseToml } from '@iarna/toml'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import type { ConfigFile, ConfigWithSource, PandoConfig, PartialPandoConfig } from './schema'
import { ConfigSource, DEFAULT_CONFIG, validateConfig, validatePartialConfig } from './schema'
import { getEnvConfig, hasEnvConfig } from './env'

/**
 * Configuration Loader
 *
 * Discovers and loads Pando configuration from multiple sources:
 * 1. .pando.toml (current directory)
 * 2. Project files (pyproject.toml, Cargo.toml, package.json, etc.)
 * 3. Global config (~/.config/pando/config.toml)
 *
 * Merges configurations with proper priority handling.
 */

// ============================================================================
// Configuration File Patterns
// ============================================================================

/**
 * Supported configuration files and their patterns
 */
const CONFIG_FILES = {
  PANDO_TOML: '.pando.toml',
  PYPROJECT_TOML: 'pyproject.toml',
  CARGO_TOML: 'Cargo.toml',
  PACKAGE_JSON: 'package.json',
  DENO_JSON: 'deno.json',
  COMPOSER_JSON: 'composer.json',
} as const

/**
 * Priority order for configuration sources (higher = more priority)
 */
const SOURCE_PRIORITY: Record<ConfigSource, number> = {
  [ConfigSource.CLI_FLAG]: 100,

  [ConfigSource.ENV_VARS]: 90,

  [ConfigSource.ENV_VAR]: 90,

  [ConfigSource.PANDO_TOML]: 80,

  [ConfigSource.PYPROJECT_TOML]: 70,

  [ConfigSource.CARGO_TOML]: 69,

  [ConfigSource.PACKAGE_JSON]: 68,

  [ConfigSource.DENO_JSON]: 67,

  [ConfigSource.COMPOSER_JSON]: 66,

  [ConfigSource.GLOBAL_CONFIG]: 50,

  [ConfigSource.DEFAULT]: 0,
}

// ============================================================================
// Configuration Discovery
// ============================================================================

/**
 * Discover all configuration files from current directory to git root
 *
 * Walks up the directory tree looking for supported config files.
 * Stops at git root to avoid searching above the repository.
 *
 * @param startDir - Starting directory for search
 * @param gitRoot - Git repository root (search boundary)
 * @returns Array of discovered config files with metadata
 */
export async function discoverConfigFiles(
  startDir: string,
  gitRoot: string
): Promise<ConfigFile[]> {
  const configFiles: ConfigFile[] = []
  let currentDir = path.resolve(startDir)
  const resolvedGitRoot = path.resolve(gitRoot)

  // Walk up directory tree from startDir to gitRoot
  while (true) {
    // Check each config file type at this level
    for (const fileName of Object.values(CONFIG_FILES)) {
      const filePath = path.join(currentDir, fileName)
      const exists = await configFileExists(filePath)

      // Map filename to ConfigSource
      let source: ConfigSource
      switch (fileName) {
        case CONFIG_FILES.PANDO_TOML:
          source = ConfigSource.PANDO_TOML
          break
        case CONFIG_FILES.PYPROJECT_TOML:
          source = ConfigSource.PYPROJECT_TOML
          break
        case CONFIG_FILES.CARGO_TOML:
          source = ConfigSource.CARGO_TOML
          break
        case CONFIG_FILES.PACKAGE_JSON:
          source = ConfigSource.PACKAGE_JSON
          break
        case CONFIG_FILES.DENO_JSON:
          source = ConfigSource.DENO_JSON
          break
        case CONFIG_FILES.COMPOSER_JSON:
          source = ConfigSource.COMPOSER_JSON
          break
        default:
          continue
      }

      configFiles.push({
        path: filePath,
        source,
        priority: SOURCE_PRIORITY[source],
        exists,
      })
    }

    // Stop if we've reached the git root
    if (currentDir === resolvedGitRoot) {
      break
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir)

    // Stop if we've reached filesystem root
    if (parentDir === currentDir) {
      break
    }

    currentDir = parentDir
  }

  // Check for global config
  const globalConfigPath = getGlobalConfigPath()
  const globalExists = await configFileExists(globalConfigPath)
  configFiles.push({
    path: globalConfigPath,
    source: ConfigSource.GLOBAL_CONFIG,
    priority: SOURCE_PRIORITY[ConfigSource.GLOBAL_CONFIG],
    exists: globalExists,
  })

  return configFiles
}

/**
 * Get global configuration file path
 *
 * @returns Path to global config file (~/.config/pando/config.toml)
 */
export function getGlobalConfigPath(): string {
  return path.join(os.homedir(), '.config', 'pando', 'config.toml')
}

/**
 * Check if a configuration file exists
 *
 * @param filePath - Path to check
 * @returns True if file exists and is readable
 */
export async function configFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Configuration Parsers
// ============================================================================

/**
 * Parse .pando.toml file
 *
 * @param filePath - Path to .pando.toml
 * @returns Parsed configuration (root level)
 */
export async function parsePandoToml(filePath: string): Promise<PartialPandoConfig> {
  const contents = await fs.readFile(filePath, 'utf-8')
  const parsed = parseToml(contents) as any
  return validatePartialConfig(parsed)
}

/**
 * Parse pyproject.toml file
 *
 * Extracts [tool.pando] section
 *
 * @param filePath - Path to pyproject.toml
 * @returns Parsed configuration from [tool.pando] section
 */
export async function parsePyprojectToml(filePath: string): Promise<PartialPandoConfig> {
  const contents = await fs.readFile(filePath, 'utf-8')
  const parsed = parseToml(contents) as any
  const pandoConfig = parsed?.tool?.pando || {}
  return validatePartialConfig(pandoConfig)
}

/**
 * Parse Cargo.toml file
 *
 * Extracts [package.metadata.pando] section
 *
 * @param filePath - Path to Cargo.toml
 * @returns Parsed configuration from [package.metadata.pando] section
 */
export async function parseCargoToml(filePath: string): Promise<PartialPandoConfig> {
  const contents = await fs.readFile(filePath, 'utf-8')
  const parsed = parseToml(contents) as any
  const pandoConfig = parsed?.package?.metadata?.pando || {}
  return validatePartialConfig(pandoConfig)
}

/**
 * Parse package.json file
 *
 * Extracts "pando" key
 *
 * @param filePath - Path to package.json
 * @returns Parsed configuration from "pando" key
 */
export async function parsePackageJson(filePath: string): Promise<PartialPandoConfig> {
  const contents = await fs.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(contents)
  const pandoConfig = parsed?.pando || {}
  return validatePartialConfig(pandoConfig)
}

/**
 * Parse deno.json file
 *
 * Extracts "pando" key
 *
 * @param filePath - Path to deno.json
 * @returns Parsed configuration from "pando" key
 */
export async function parseDenoJson(filePath: string): Promise<PartialPandoConfig> {
  const contents = await fs.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(contents)
  const pandoConfig = parsed?.pando || {}
  return validatePartialConfig(pandoConfig)
}

/**
 * Parse composer.json file
 *
 * Extracts "extra.pando" section
 *
 * @param filePath - Path to composer.json
 * @returns Parsed configuration from "extra.pando" section
 */
export async function parseComposerJson(filePath: string): Promise<PartialPandoConfig> {
  const contents = await fs.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(contents)
  const pandoConfig = parsed?.extra?.pando || {}
  return validatePartialConfig(pandoConfig)
}

/**
 * Parse configuration file based on its type
 *
 * @param configFile - Config file metadata
 * @returns Parsed configuration
 */
export async function parseConfigFile(configFile: ConfigFile): Promise<PartialPandoConfig> {
  // TODO: Implement parser dispatcher
  // Switch on configFile.source and call appropriate parser
  // Handle parse errors gracefully (log warning, return empty config)
  switch (configFile.source) {
    case ConfigSource.PANDO_TOML:
    case ConfigSource.GLOBAL_CONFIG:
      return parsePandoToml(configFile.path)
    case ConfigSource.PYPROJECT_TOML:
      return parsePyprojectToml(configFile.path)
    case ConfigSource.CARGO_TOML:
      return parseCargoToml(configFile.path)
    case ConfigSource.PACKAGE_JSON:
      return parsePackageJson(configFile.path)
    case ConfigSource.DENO_JSON:
      return parseDenoJson(configFile.path)
    case ConfigSource.COMPOSER_JSON:
      return parseComposerJson(configFile.path)
    default:
      return {}
  }
}

// ============================================================================
// Configuration Merging
// ============================================================================

/**
 * Deep merge two configuration objects
 *
 * Higher priority config values override lower priority values.
 * Arrays are replaced (not concatenated).
 *
 * @param base - Lower priority config
 * @param override - Higher priority config
 * @returns Merged configuration
 */
export function mergeConfigs(
  base: PartialPandoConfig,
  override: PartialPandoConfig
): PartialPandoConfig {
  const result: PartialPandoConfig = { ...base }

  for (const key of Object.keys(override) as Array<keyof PartialPandoConfig>) {
    const overrideValue = override[key]

    if (overrideValue === undefined) {
      continue
    }

    // If value is an array, replace entirely (don't concatenate)
    if (Array.isArray(overrideValue)) {
      ;(result as any)[key] = overrideValue
      continue
    }

    // If value is an object (and not null), recursively merge
    if (typeof overrideValue === 'object' && overrideValue !== null) {
      const baseValue = base[key]
      if (typeof baseValue === 'object' && baseValue !== null && !Array.isArray(baseValue)) {
        ;(result as any)[key] = { ...baseValue, ...overrideValue }
      } else {
        ;(result as any)[key] = overrideValue
      }
      continue
    }

    // Otherwise, replace value
    ;(result as any)[key] = overrideValue
  }

  return result
}

/**
 * Merge multiple configuration sources
 *
 * Configs are merged in priority order (lower priority first).
 *
 * @param configs - Array of (config, source) tuples
 * @returns Merged configuration with source tracking
 */
export function mergeMultipleConfigs(
  configs: Array<{ config: PartialPandoConfig; source: ConfigSource }>
): ConfigWithSource {
  // Sort configs by priority (lowest first)
  const sortedConfigs = [...configs].sort(
    (a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
  )

  // Start with DEFAULT_CONFIG
  let mergedConfig: PartialPandoConfig = { ...DEFAULT_CONFIG }
  const sources: { [key: string]: ConfigSource } = {}

  // Initialize sources with DEFAULT
  sources['rsync'] = ConfigSource.DEFAULT
  sources['rsync.enabled'] = ConfigSource.DEFAULT
  sources['rsync.flags'] = ConfigSource.DEFAULT
  sources['rsync.exclude'] = ConfigSource.DEFAULT
  sources['symlink'] = ConfigSource.DEFAULT
  sources['symlink.patterns'] = ConfigSource.DEFAULT
  sources['symlink.relative'] = ConfigSource.DEFAULT
  sources['symlink.beforeRsync'] = ConfigSource.DEFAULT

  // Merge each config in priority order
  for (const { config, source } of sortedConfigs) {
    mergedConfig = mergeConfigs(mergedConfig, config)

    // Track source for each top-level key
    for (const key of Object.keys(config) as Array<keyof PartialPandoConfig>) {
      if (config[key] !== undefined) {
        sources[key] = source

        // Track source for nested keys
        const nestedConfig = config[key]
        if (typeof nestedConfig === 'object' && nestedConfig !== null) {
          for (const nestedKey of Object.keys(nestedConfig)) {
            if ((nestedConfig as any)[nestedKey] !== undefined) {
              sources[`${key}.${nestedKey}`] = source
            }
          }
        }
      }
    }
  }

  // Validate final config
  const validatedConfig = validateConfig(mergedConfig)

  return {
    config: validatedConfig,
    sources,
  }
}

// ============================================================================
// Configuration Loading (Main API)
// ============================================================================

/**
 * Configuration loader with caching
 */
export class ConfigLoader {
  private cache: Map<string, PandoConfig> = new Map()

  /**
   * Load configuration from all sources
   *
   * @param options - Load options
   * @returns Complete merged configuration
   */
  async load(options: {
    cwd?: string
    gitRoot?: string
    skipCache?: boolean
  }): Promise<PandoConfig> {
    const cwd = options.cwd || process.cwd()
    const gitRoot = options.gitRoot || cwd

    // Check cache unless skipCache is true
    const cacheKey = `${cwd}:${gitRoot}`
    if (!options.skipCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }

    // Discover all config files
    const configFiles = await discoverConfigFiles(cwd, gitRoot)

    // Parse each config file that exists
    const parsedConfigs: Array<{ config: PartialPandoConfig; source: ConfigSource }> = []

    for (const configFile of configFiles) {
      if (!configFile.exists) {
        continue
      }

      try {
        const config = await parseConfigFile(configFile)
        parsedConfigs.push({
          config,
          source: configFile.source,
        })
      } catch (error) {
        // Log warning but continue with other configs
        console.warn(`Failed to parse ${configFile.path}:`, error)
      }
    }

    // Add environment variables with priority 90
    const envConfig = getEnvConfig()
    if (hasEnvConfig()) {
      parsedConfigs.push({
        config: envConfig,
        source: ConfigSource.ENV_VARS,
      })
    }

    // Merge all configs with priority
    const { config: mergedConfig } = mergeMultipleConfigs(parsedConfigs)

    // Cache result
    this.cache.set(cacheKey, mergedConfig)

    return mergedConfig
  }

  /**
   * Load configuration with source tracking
   *
   * Useful for debugging to see where each setting comes from.
   *
   * @param options - Load options
   * @returns Configuration with source metadata
   */
  async loadWithSources(options: { cwd?: string; gitRoot?: string }): Promise<ConfigWithSource> {
    const cwd = options.cwd || process.cwd()
    const gitRoot = options.gitRoot || cwd

    // Discover all config files
    const configFiles = await discoverConfigFiles(cwd, gitRoot)

    // Parse each config file that exists
    const parsedConfigs: Array<{ config: PartialPandoConfig; source: ConfigSource }> = []

    for (const configFile of configFiles) {
      if (!configFile.exists) {
        continue
      }

      try {
        const config = await parseConfigFile(configFile)
        parsedConfigs.push({
          config,
          source: configFile.source,
        })
      } catch (error) {
        // Log warning but continue with other configs
        console.warn(`Failed to parse ${configFile.path}:`, error)
      }
    }

    // Add environment variables with priority 90
    const envConfig = getEnvConfig()
    if (hasEnvConfig()) {
      parsedConfigs.push({
        config: envConfig,
        source: ConfigSource.ENV_VARS,
      })
    }

    // Merge all configs with source tracking
    return mergeMultipleConfigs(parsedConfigs)
  }

  /**
   * Clear the configuration cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}

/**
 * Default config loader instance
 */
export const configLoader = new ConfigLoader()

/**
 * Load configuration (convenience function)
 *
 * @param options - Load options
 * @returns Complete merged configuration
 */
export async function loadConfig(options?: {
  cwd?: string
  gitRoot?: string
  skipCache?: boolean
}): Promise<PandoConfig> {
  return configLoader.load(options || {})
}
