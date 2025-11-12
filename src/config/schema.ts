import { z } from 'zod'

/**
 * Configuration Schema for Pando
 *
 * Defines TypeScript interfaces and Zod schemas for validating
 * configuration from multiple sources (.pando.toml, pyproject.toml,
 * package.json, environment variables, etc.)
 */

// ============================================================================
// Zod Schemas (for validation)
// ============================================================================

/**
 * Rsync configuration schema
 */
export const RsyncConfigSchema = z.object({
  enabled: z.boolean().default(true),
  flags: z.array(z.string()).default(['--archive', '--exclude', '.git']),
  exclude: z.array(z.string()).default([]),
})

/**
 * Symlink configuration schema
 */
export const SymlinkConfigSchema = z.object({
  patterns: z.array(z.string()).default([]),
  relative: z.boolean().default(true),
  beforeRsync: z.boolean().default(true),
})

/**
 * Complete Pando configuration schema
 */
export const PandoConfigSchema = z.object({
  rsync: RsyncConfigSchema,
  symlink: SymlinkConfigSchema,
})

// ============================================================================
// TypeScript Interfaces (inferred from Zod schemas)
// ============================================================================

/**
 * Rsync configuration options
 *
 * Controls how files are copied from the source tree to new worktrees
 */
export interface RsyncConfig {
  /**
   * Whether rsync is enabled for new worktrees
   * @default true
   */
  enabled: boolean

  /**
   * Flags to pass to rsync command
   * @default ['--archive', '--exclude', '.git']
   */
  flags: string[]

  /**
   * Additional patterns to exclude from rsync
   * @default []
   * @example ['*.log', 'tmp/', 'node_modules/']
   */
  exclude: string[]
}

/**
 * Symlink configuration options
 *
 * Controls which files are symlinked instead of copied
 */
export interface SymlinkConfig {
  /**
   * Glob patterns for files to symlink
   * @default []
   * @example ['package.json', 'pnpm-lock.yaml', '.env*']
   */
  patterns: string[]

  /**
   * Use relative symlinks instead of absolute
   * @default true
   */
  relative: boolean

  /**
   * Create symlinks before rsync (true) or after (false)
   * @default true
   */
  beforeRsync: boolean
}

/**
 * Complete Pando configuration
 */
export interface PandoConfig {
  rsync: RsyncConfig
  symlink: SymlinkConfig
}

/**
 * Partial configuration (used for merging)
 */
export type PartialPandoConfig = {
  rsync?: Partial<RsyncConfig>
  symlink?: Partial<SymlinkConfig>
}

// ============================================================================
// Configuration Source Types
// ============================================================================

/**
 * Where a configuration value came from
 */
export enum ConfigSource {
  CLI_FLAG = 'cli_flag',
  ENV_VAR = 'env_var',
  PANDO_TOML = 'pando_toml',
  PYPROJECT_TOML = 'pyproject_toml',
  CARGO_TOML = 'cargo_toml',
  PACKAGE_JSON = 'package_json',
  DENO_JSON = 'deno_json',
  COMPOSER_JSON = 'composer_json',
  GLOBAL_CONFIG = 'global_config',
  DEFAULT = 'default',
}

/**
 * Configuration with source tracking
 * Used for debugging and showing where settings come from
 */
export interface ConfigWithSource {
  config: PandoConfig
  sources: {
    [key: string]: ConfigSource
  }
}

/**
 * A discovered configuration file
 */
export interface ConfigFile {
  path: string
  source: ConfigSource
  priority: number
  exists: boolean
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default configuration values
 *
 * Used when no configuration files are found
 */
export const DEFAULT_CONFIG: PandoConfig = {
  rsync: {
    enabled: true,
    flags: ['--archive', '--exclude', '.git'],
    exclude: [],
  },
  symlink: {
    patterns: [],
    relative: true,
    beforeRsync: true,
  },
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate configuration against schema
 *
 * @param config - Configuration object to validate
 * @returns Validated configuration with defaults applied
 * @throws {z.ZodError} If configuration is invalid
 */
export function validateConfig(config: unknown): PandoConfig {
  // TODO: Implement validation
  // 1. Parse config with PandoConfigSchema
  // 2. Apply defaults for missing values
  // 3. Return validated config
  // 4. Throw ZodError with detailed messages if invalid
  return PandoConfigSchema.parse(config)
}

/**
 * Validate partial configuration (for merging)
 *
 * @param config - Partial configuration to validate
 * @returns Validated partial configuration
 */
export function validatePartialConfig(config: unknown): PartialPandoConfig {
  // TODO: Implement partial validation
  // 1. Parse config with PandoConfigSchema.partial()
  // 2. Return validated partial config
  // 3. Throw ZodError if invalid
  return PandoConfigSchema.partial({ rsync: true, symlink: true }).parse(config)
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if value is a valid RsyncConfig
 */
export function isRsyncConfig(value: unknown): value is RsyncConfig {
  try {
    RsyncConfigSchema.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * Check if value is a valid SymlinkConfig
 */
export function isSymlinkConfig(value: unknown): value is SymlinkConfig {
  try {
    SymlinkConfigSchema.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * Check if value is a valid PandoConfig
 */
export function isPandoConfig(value: unknown): value is PandoConfig {
  try {
    PandoConfigSchema.parse(value)
    return true
  } catch {
    return false
  }
}
