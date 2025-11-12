import { parse as parseToml } from '@iarna/toml'
import * as fs from 'fs-extra'
import * as path from 'path'
import type {
  ConfigFile,
  ConfigSource,
  ConfigWithSource,
  PandoConfig,
  PartialPandoConfig,
} from './schema'
import { DEFAULT_CONFIG, validateConfig, validatePartialConfig } from './schema'

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
  // TODO: Implement directory walking
  // 1. Start from startDir
  // 2. At each level, check for all CONFIG_FILES
  // 3. Record found files with their source type and priority
  // 4. Move up one directory
  // 5. Stop when we reach gitRoot or filesystem root
  // 6. Return array of ConfigFile objects

  // TODO: Also check for global config
  // Path: ~/.config/pando/config.toml
  // Add to array with GLOBAL_CONFIG source

  throw new Error('Not implemented')
}

/**
 * Get global configuration file path
 *
 * @returns Path to global config file (~/.config/pando/config.toml)
 */
export function getGlobalConfigPath(): string {
  // TODO: Implement global config path
  // Return: path.join(os.homedir(), '.config', 'pando', 'config.toml')
  throw new Error('Not implemented')
}

/**
 * Check if a configuration file exists
 *
 * @param filePath - Path to check
 * @returns True if file exists and is readable
 */
export async function configFileExists(filePath: string): Promise<boolean> {
  // TODO: Implement existence check
  // Use fs.access or fs.pathExists
  throw new Error('Not implemented')
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
  // TODO: Implement .pando.toml parser
  // 1. Read file contents
  // 2. Parse TOML
  // 3. Extract root-level config (no namespace needed)
  // 4. Validate with validatePartialConfig
  // 5. Return parsed config
  throw new Error('Not implemented')
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
  // TODO: Implement pyproject.toml parser
  // 1. Read file contents
  // 2. Parse TOML
  // 3. Extract tool.pando section
  // 4. Validate with validatePartialConfig
  // 5. Return empty object if tool.pando doesn't exist
  throw new Error('Not implemented')
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
  // TODO: Implement Cargo.toml parser
  // 1. Read file contents
  // 2. Parse TOML
  // 3. Extract package.metadata.pando section
  // 4. Validate with validatePartialConfig
  // 5. Return empty object if section doesn't exist
  throw new Error('Not implemented')
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
  // TODO: Implement package.json parser
  // 1. Read file contents
  // 2. Parse JSON
  // 3. Extract pando key
  // 4. Validate with validatePartialConfig
  // 5. Return empty object if pando key doesn't exist
  throw new Error('Not implemented')
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
  // TODO: Implement deno.json parser
  // 1. Read file contents
  // 2. Parse JSON
  // 3. Extract pando key
  // 4. Validate with validatePartialConfig
  // 5. Return empty object if pando key doesn't exist
  throw new Error('Not implemented')
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
  // TODO: Implement composer.json parser
  // 1. Read file contents
  // 2. Parse JSON
  // 3. Extract extra.pando section
  // 4. Validate with validatePartialConfig
  // 5. Return empty object if extra.pando doesn't exist
  throw new Error('Not implemented')
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
  // TODO: Implement deep merge
  // 1. Create shallow copy of base
  // 2. For each key in override:
  //    - If value is object, recursively merge
  //    - If value is array, replace entirely (don't concatenate)
  //    - Otherwise, replace value
  // 3. Return merged config
  throw new Error('Not implemented')
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
  // TODO: Implement multiple config merging
  // 1. Sort configs by priority (lowest first)
  // 2. Start with DEFAULT_CONFIG
  // 3. Merge each config in order
  // 4. Track which source each value came from
  // 5. Return ConfigWithSource object
  throw new Error('Not implemented')
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
    // TODO: Implement configuration loading
    // 1. Check cache unless skipCache is true
    // 2. Discover all config files
    // 3. Parse each config file
    // 4. Merge all configs with priority
    // 5. Validate final config
    // 6. Cache result
    // 7. Return validated config

    throw new Error('Not implemented')
  }

  /**
   * Load configuration with source tracking
   *
   * Useful for debugging to see where each setting comes from.
   *
   * @param options - Load options
   * @returns Configuration with source metadata
   */
  async loadWithSources(options: {
    cwd?: string
    gitRoot?: string
  }): Promise<ConfigWithSource> {
    // TODO: Implement loading with source tracking
    // Similar to load() but returns ConfigWithSource
    // Used by config:show command
    throw new Error('Not implemented')
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
