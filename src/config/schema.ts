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
 * Rsync configuration schema without defaults (for partial config validation)
 */
export const RsyncConfigSchemaPartial = z.object({
  enabled: z.boolean().optional(),
  flags: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
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
 * Symlink configuration schema without defaults (for partial config validation)
 */
export const SymlinkConfigSchemaPartial = z.object({
  patterns: z.array(z.string()).optional(),
  relative: z.boolean().optional(),
  beforeRsync: z.boolean().optional(),
})

/**
 * Branch deletion options for worktree remove
 */
export const DeleteBranchOptionSchema = z.enum(['none', 'local', 'remote'])
export type DeleteBranchOption = z.infer<typeof DeleteBranchOptionSchema>

/**
 * Worktree configuration schema
 */
export const WorktreeConfigSchema = z.object({
  defaultPath: z.string().optional(),
  rebaseOnAdd: z.boolean().default(true),
  deleteBranchOnRemove: DeleteBranchOptionSchema.default('none'),
})

/**
 * Worktree configuration schema without defaults (for partial config validation)
 */
export const WorktreeConfigSchemaPartial = z.object({
  defaultPath: z.string().optional(),
  rebaseOnAdd: z.boolean().optional(),
  deleteBranchOnRemove: DeleteBranchOptionSchema.optional(),
})

/**
 * Complete Pando configuration schema
 */
export const PandoConfigSchema = z.object({
  rsync: RsyncConfigSchema,
  symlink: SymlinkConfigSchema,
  worktree: WorktreeConfigSchema,
})

/**
 * Partial Pando configuration schema without defaults
 */
export const PartialPandoConfigSchema = z.object({
  rsync: RsyncConfigSchemaPartial.optional(),
  symlink: SymlinkConfigSchemaPartial.optional(),
  worktree: WorktreeConfigSchemaPartial.optional(),
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
 * Worktree configuration options
 *
 * Controls default paths and behavior for worktree operations
 */
export interface WorktreeConfig {
  /**
   * Default parent directory for worktrees
   * Can be relative (to git root) or absolute path
   * @default undefined
   * @example '../worktrees' or '/absolute/path/to/worktrees'
   */
  defaultPath?: string

  /**
   * Automatically rebase existing branches onto source branch when adding worktree
   * @default true
   */
  rebaseOnAdd?: boolean

  /**
   * Delete branch when removing worktree
   * - 'none': Don't delete any branches (default)
   * - 'local': Delete local branch only
   * - 'remote': Delete both local and remote branches
   * @default 'none'
   */
  deleteBranchOnRemove?: DeleteBranchOption
}

/**
 * Complete Pando configuration
 */
export interface PandoConfig {
  rsync: RsyncConfig
  symlink: SymlinkConfig
  worktree: WorktreeConfig
}

/**
 * Partial configuration (used for merging)
 */
export type PartialPandoConfig = {
  rsync?: Partial<RsyncConfig>
  symlink?: Partial<SymlinkConfig>
  worktree?: Partial<WorktreeConfig>
}

// ============================================================================
// Configuration Source Types
// ============================================================================

/**
 * Where a configuration value came from
 */
export enum ConfigSource {
  CLI_FLAG = 'cli_flag',
  ENV_VARS = 'env_vars',
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
  worktree: {
    rebaseOnAdd: true,
    deleteBranchOnRemove: 'none',
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
  return PandoConfigSchema.parse(config)
}

/**
 * Validate partial configuration (for merging)
 *
 * @param config - Partial configuration to validate
 * @returns Validated partial configuration
 */
export function validatePartialConfig(config: unknown): PartialPandoConfig {
  return PartialPandoConfigSchema.parse(config)
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
 * Check if value is a valid WorktreeConfig
 */
export function isWorktreeConfig(value: unknown): value is WorktreeConfig {
  try {
    WorktreeConfigSchema.parse(value)
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
