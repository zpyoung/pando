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
  onlyUntracked: z.boolean().default(true),
})

/**
 * Rsync configuration schema without defaults (for partial config validation)
 */
export const RsyncConfigSchemaPartial = z.object({
  enabled: z.boolean().optional(),
  flags: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  onlyUntracked: z.boolean().optional(),
})

/**
 * Symlink configuration schema
 */
export const SymlinkConfigSchema = z.object({
  patterns: z.array(z.string()).default([]),
  relative: z.boolean().default(true),
  beforeRsync: z.boolean().default(true),
  allowTracked: z.boolean().default(true),
})

/**
 * Symlink configuration schema without defaults (for partial config validation)
 */
export const SymlinkConfigSchemaPartial = z.object({
  patterns: z.array(z.string()).optional(),
  relative: z.boolean().optional(),
  beforeRsync: z.boolean().optional(),
  allowTracked: z.boolean().optional(),
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
  defaultKind: z.enum(['auto', 'ephemeral', 'long-lived']).default('auto'),
  ephemeralTtl: z.string().default('4h'),
  autoLockActive: z.boolean().default(true),
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
  defaultKind: z.enum(['auto', 'ephemeral', 'long-lived']).optional(),
  ephemeralTtl: z.string().optional(),
  autoLockActive: z.boolean().optional(),
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
 * Reap configuration schema
 */
export const ReapConfigSchema = z.object({
  requireMerged: z.boolean().default(true),
})

/**
 * Reap configuration schema without defaults (for partial config validation)
 */
export const ReapConfigSchemaPartial = z.object({
  requireMerged: z.boolean().optional(),
})

/**
 * Retry configuration schema
 */
export const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().default(5),
  baseMs: z.number().int().nonnegative().default(100),
  capMs: z.number().int().positive().default(2000),
})

/**
 * Retry configuration schema without defaults (for partial config validation)
 */
export const RetryConfigSchemaPartial = z.object({
  maxAttempts: z.number().int().positive().optional(),
  baseMs: z.number().int().nonnegative().optional(),
  capMs: z.number().int().positive().optional(),
})

/**
 * Concurrency configuration schema
 */
export const ConcurrencyConfigSchema = z.object({
  retry: RetryConfigSchema,
})

/**
 * Concurrency configuration schema without defaults (for partial config validation)
 */
export const ConcurrencyConfigSchemaPartial = z.object({
  retry: RetryConfigSchemaPartial.optional(),
})

/**
 * Port allocation configuration schema
 */
export const PortsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  range: z.string().default('3100-3199'),
  names: z.array(z.string()).default(['web']),
  dbStrategy: z.enum(['named']).default('named'),
  dbBaseName: z.string().default('dev'),
})

/**
 * Port allocation configuration schema without defaults (for partial config validation)
 */
export const PortsConfigSchemaPartial = z.object({
  enabled: z.boolean().optional(),
  range: z.string().optional(),
  names: z.array(z.string()).optional(),
  dbStrategy: z.enum(['named']).optional(),
  dbBaseName: z.string().optional(),
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

export const PostCommandsConfigSchema = z
  .record(z.string(), z.array(PostCommandScriptSchema))
  .default({})
export const PostCommandsConfigSchemaPartial = z
  .record(z.string(), z.array(PostCommandScriptSchema))
  .optional()

/**
 * Complete Pando configuration schema
 */
export const PandoConfigSchema = z.object({
  rsync: RsyncConfigSchema,
  symlink: SymlinkConfigSchema,
  worktree: WorktreeConfigSchema,
  clean: CleanConfigSchema,
  reap: ReapConfigSchema,
  concurrency: ConcurrencyConfigSchema,
  ports: PortsConfigSchema,
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
  reap: ReapConfigSchemaPartial.optional(),
  concurrency: ConcurrencyConfigSchemaPartial.optional(),
  ports: PortsConfigSchemaPartial.optional(),
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

  /**
   * Only sync files that are untracked in the source worktree (build artifacts,
   * virtualenvs, caches). Tracked files come from git checkout, so copying them
   * would dirty the new worktree whenever branches differ. When false, the full
   * source tree is mirrored - but only when source and target are on the same
   * commit (a safety guard against cross-branch clobbering).
   * @default true
   */
  onlyUntracked?: boolean
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

  /**
   * Allow symlinking paths that are git-tracked in the new worktree
   * (lockfiles, package.json). Tracked-path symlinks would show as
   * deleted/type-changed in git status, so pando hides them via
   * skip-worktree - local, per-clone state that git can silently drop; the
   * post-setup clean-tree check catches any drift. Set to false to skip
   * tracked patterns with a warning instead (strict mode: symlink only
   * gitignored paths).
   * @default true
   */
  allowTracked?: boolean
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

  /**
   * Default lifecycle kind assigned to new worktrees
   * @default 'auto'
   */
  defaultKind?: 'auto' | 'ephemeral' | 'long-lived'

  /**
   * Time-to-live assigned to ephemeral worktrees
   * @default '4h'
   */
  ephemeralTtl?: string

  /**
   * Automatically lock active worktrees against reaping
   * @default true
   */
  autoLockActive?: boolean
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

/**
 * Reap configuration options
 *
 * Controls safeguards applied while reaping worktrees
 */
export interface ReapConfig {
  /**
   * Require a worktree branch to be merged before reaping it
   * @default true
   */
  requireMerged: boolean
}

/**
 * Retry configuration options
 *
 * Controls retry backoff for concurrent lifecycle operations
 */
export interface RetryConfig {
  /**
   * Maximum number of attempts before failing
   * @default 5
   */
  maxAttempts: number

  /**
   * Initial retry delay in milliseconds
   * @default 100
   */
  baseMs: number

  /**
   * Maximum retry delay in milliseconds
   * @default 2000
   */
  capMs: number
}

/**
 * Concurrency configuration options
 */
export interface ConcurrencyConfig {
  /**
   * Retry behavior for concurrent lifecycle operations
   */
  retry: RetryConfig
}

/**
 * Port allocation configuration options
 *
 * Controls deterministic port and database allocation for worktrees
 */
export interface PortsConfig {
  /**
   * Whether port allocation is enabled
   * @default false
   */
  enabled: boolean

  /**
   * Inclusive port range available for allocation
   * @default '3100-3199'
   */
  range: string

  /**
   * Logical service names that receive allocated ports
   * @default ['web']
   */
  names: string[]

  /**
   * Database naming strategy
   * @default 'named'
   */
  dbStrategy: 'named'

  /**
   * Base name used when deriving worktree database names
   * @default 'dev'
   */
  dbBaseName: string
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
  reap: ReapConfig
  concurrency: ConcurrencyConfig
  ports: PortsConfig
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
  reap?: Partial<ReapConfig>
  concurrency?: {
    retry?: Partial<RetryConfig>
  }
  ports?: Partial<PortsConfig>
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
export const DEFAULT_CONFIG = PandoConfigSchema.parse({
  rsync: {},
  symlink: {},
  worktree: {},
  clean: {},
  reap: {},
  concurrency: { retry: {} },
  ports: {},
})

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
