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
  // Note: `.git` is excluded programmatically in fileOps.buildArgs (non-configurable),
  // so it must NOT be duplicated in the default flags.
  flags: z.array(z.string()).default(['--archive']),
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
  deleteBranchOnRemove: DeleteBranchOptionSchema.default('local'),
  useProjectSubfolder: z.boolean().default(false),
  targetBranch: z.string().default('main'),
})

/**
 * Worktree configuration schema without defaults (for partial config validation)
 */
export const WorktreeConfigSchemaPartial = z.object({
  defaultPath: z.string().optional(),
  rebaseOnAdd: z.boolean().optional(),
  deleteBranchOnRemove: DeleteBranchOptionSchema.optional(),
  useProjectSubfolder: z.boolean().optional(),
  targetBranch: z.string().optional(),
})

/**
 * Clean configuration schema
 */
export const CleanConfigSchema = z.object({
  fetch: z.boolean().default(false),
})

/**
 * Clean configuration schema without defaults (for partial config validation)
 */
export const CleanConfigSchemaPartial = z.object({
  fetch: z.boolean().optional(),
})

/**
 * Post-command script configuration schema
 */
export const PostCommandScriptSchema = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    command: z.string(),
  }),
])

export const PostCommandsConfigSchema = z.record(z.array(PostCommandScriptSchema)).default({})
export const PostCommandsConfigSchemaPartial = z.record(z.array(PostCommandScriptSchema)).optional()

/**
 * Complete Pando configuration schema
 */
export const PandoConfigSchema = z.object({
  rsync: RsyncConfigSchema,
  symlink: SymlinkConfigSchema,
  worktree: WorktreeConfigSchema,
  clean: CleanConfigSchema,
  postCommands: PostCommandsConfigSchema,
})

/**
 * Partial Pando configuration schema without defaults
 */
export const PartialPandoConfigSchema = z.object({
  rsync: RsyncConfigSchemaPartial.optional(),
  symlink: SymlinkConfigSchemaPartial.optional(),
  worktree: WorktreeConfigSchemaPartial.optional(),
  clean: CleanConfigSchemaPartial.optional(),
  postCommands: PostCommandsConfigSchemaPartial,
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
   * Note: `.git` is excluded programmatically (non-configurable), so it is not
   * part of the default flags.
   * @default ['--archive']
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
   * - 'none': Don't delete any branches
   * - 'local': Delete local branch only (default)
   * - 'remote': Delete both local and remote branches
   * @default 'local'
   */
  deleteBranchOnRemove?: DeleteBranchOption

  /**
   * Create worktrees in a project-specific subfolder under defaultPath
   * When true: defaultPath/projectName/branchName
   * When false: defaultPath/branchName
   * @default false
   * @example With defaultPath='../worktrees', project='myapp', branch='feature':
   *          true  -> ../worktrees/myapp/feature
   *          false -> ../worktrees/feature
   */
  useProjectSubfolder?: boolean

  /**
   * Target branch for merge checks (used by clean command)
   * @default 'main'
   */
  targetBranch?: string
}

/**
 * Clean configuration options
 *
 * Controls behavior of the clean command
 */
export interface CleanConfig {
  /**
   * Run git fetch --prune before detection
   * @default false
   */
  fetch: boolean
}

export type PostCommandScript = z.infer<typeof PostCommandScriptSchema>

/**
 * Post-command script configuration.
 *
 * Keys are command ids such as "add". Values are shell commands that run after
 * the core command succeeds.
 */
export type PostCommandsConfig = Record<string, PostCommandScript[]>

/**
 * Complete Pando configuration
 */
export interface PandoConfig {
  rsync: RsyncConfig
  symlink: SymlinkConfig
  worktree: WorktreeConfig
  clean: CleanConfig
  postCommands: PostCommandsConfig
}

/**
 * Partial configuration (used for merging)
 */
export type PartialPandoConfig = {
  rsync?: Partial<RsyncConfig>
  symlink?: Partial<SymlinkConfig>
  worktree?: Partial<WorktreeConfig>
  clean?: Partial<CleanConfig>
  postCommands?: PostCommandsConfig
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

/**
 * Represents a configuration parsing error
 */
export interface ConfigParseError {
  /** Path to the config file that failed to parse */
  path: string
  /** The source type of the config file */
  source: ConfigSource
  /** Error message describing the parse failure */
  message: string
  /** Whether this is a project-level config (true) or global config (false) */
  isProjectConfig: boolean
  /** Line number if available from parser */
  line?: number
  /** Column number if available from parser */
  column?: number
}

/**
 * Extended result from config loading that includes errors
 */
export interface ConfigLoadResult {
  /** The merged configuration (may use defaults if errors occurred) */
  config: PandoConfig
  /** Source tracking for each config value */
  sources: { [key: string]: ConfigSource }
  /** Any errors encountered during parsing */
  errors: ConfigParseError[]
  /** Files that were successfully parsed */
  parsedFiles: ConfigFile[]
  /**
   * Absolute path of the config FILE that supplied the winning `postCommands`,
   * or undefined when post-commands came purely from environment variables (or
   * there are none). Used by the post-command trust gate.
   */
  postCommandsSourcePath?: string
}

/**
 * Custom error class for config parse failures
 * Provides consistent "run pando config show" messaging across all commands
 */
export class ConfigParseFailureError extends Error {
  constructor(public readonly errors: ConfigParseError[]) {
    const paths = errors.map((e) => `  - ${e.path}`).join('\n')
    super(
      `Configuration error: Unable to parse project configuration files:\n${paths}\n\n` +
        `Run 'pando config show' for detailed error information.`
    )
    this.name = 'ConfigParseFailureError'
  }
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
    // `.git` is excluded programmatically in fileOps.buildArgs (non-configurable).
    flags: ['--archive'],
    exclude: [],
  },
  symlink: {
    patterns: [],
    relative: true,
    beforeRsync: true,
  },
  worktree: {
    rebaseOnAdd: true,
    deleteBranchOnRemove: 'local',
    useProjectSubfolder: false,
    targetBranch: 'main',
  },
  clean: {
    fetch: false,
  },
  postCommands: {},
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
  return PandoConfigSchema.parse(config) as PandoConfig
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
 * Check if value is a valid CleanConfig
 */
export function isCleanConfig(value: unknown): value is CleanConfig {
  try {
    CleanConfigSchema.parse(value)
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
