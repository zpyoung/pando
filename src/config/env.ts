import type { PartialPandoConfig } from './schema.js'

/**
 * Environment Variable Parser
 *
 * Parses PANDO_* environment variables and converts them to configuration.
 *
 * Mapping rules:
 * - PANDO_RSYNC_ENABLED=true → rsync.enabled = true
 * - PANDO_RSYNC_FLAGS=--archive,--exclude → rsync.flags = ['--archive', '--exclude']
 * - PANDO_SYMLINK_PATTERNS=*.json,*.lock → symlink.patterns = ['*.json', '*.lock']
 *
 * Supports:
 * - Boolean values: true/false, 1/0, yes/no
 * - String arrays: comma-separated values
 * - Nested properties: PANDO_SECTION_KEY
 */

/**
 * Environment variable prefix
 */
const ENV_PREFIX = 'PANDO_'

/**
 * Supported environment variables and their config paths
 */
const ENV_VAR_MAP: Record<string, string> = {
  // Rsync settings
  PANDO_RSYNC_ENABLED: 'rsync.enabled',
  PANDO_RSYNC_FLAGS: 'rsync.flags',
  PANDO_RSYNC_EXCLUDE: 'rsync.exclude',

  // Symlink settings
  PANDO_SYMLINK_PATTERNS: 'symlink.patterns',
  PANDO_SYMLINK_RELATIVE: 'symlink.relative',
  PANDO_SYMLINK_BEFORE_RSYNC: 'symlink.beforeRsync',

  // Worktree settings
  PANDO_WORKTREE_DEFAULT_PATH: 'worktree.defaultPath',
  PANDO_WORKTREE_REBASE_ON_ADD: 'worktree.rebaseOnAdd',
}

/**
 * Parse a boolean value from string
 *
 * Supports: true/false, 1/0, yes/no (case insensitive)
 *
 * @param value - String value to parse
 * @returns Parsed boolean
 */
export function parseBoolean(value: string): boolean {
  // TODO: Implement boolean parsing
  // 1. Convert to lowercase
  // 2. Check for truthy values: 'true', '1', 'yes'
  // 3. Return true if truthy, false otherwise
  const lower = value.toLowerCase().trim()
  return ['true', '1', 'yes'].includes(lower)
}

/**
 * Parse an array value from comma-separated string
 *
 * @param value - Comma-separated string
 * @returns Array of trimmed strings
 */
export function parseArray(value: string): string[] {
  // TODO: Implement array parsing
  // 1. Split by comma
  // 2. Trim each value
  // 3. Filter out empty strings
  // 4. Return array
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

/**
 * Set a nested property on an object using dot notation
 *
 * @param obj - Object to modify
 * @param path - Dot-separated property path (e.g., 'rsync.enabled')
 * @param value - Value to set
 */
export function setNestedProperty(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  // TODO: Implement nested property setting
  // 1. Split path by '.'
  // 2. Navigate/create nested objects
  // 3. Set value at final key
  // Example: setNestedProperty({}, 'rsync.enabled', true) → { rsync: { enabled: true } }
  const keys = path.split('.')
  let current = obj

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!
    if (!(key in current)) {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }

  const lastKey = keys[keys.length - 1]!
  current[lastKey] = value
}

/**
 * Parse a single environment variable value
 *
 * Determines the type and parses accordingly:
 * - Arrays: comma-separated strings
 * - Booleans: true/false/1/0/yes/no
 * - Strings: as-is
 *
 * @param key - Environment variable key
 * @param value - Environment variable value
 * @returns Parsed value
 */
export function parseEnvValue(key: string, value: string): unknown {
  // TODO: Implement value parsing based on key
  // 1. Check if key suggests array (FLAGS, EXCLUDE, PATTERNS)
  // 2. Check if key suggests boolean (ENABLED, RELATIVE)
  // 3. Otherwise treat as string
  // 4. Return parsed value

  // Array fields
  if (key.includes('FLAGS') || key.includes('EXCLUDE') || key.includes('PATTERNS')) {
    return parseArray(value)
  }

  // Boolean fields
  if (
    key.includes('ENABLED') ||
    key.includes('RELATIVE') ||
    key.includes('BEFORE') ||
    key.includes('REBASE')
  ) {
    return parseBoolean(value)
  }

  // String fields
  return value
}

/**
 * Parse all PANDO_* environment variables
 *
 * Reads process.env and extracts/parses all PANDO_* variables.
 *
 * @param env - Environment variables object (defaults to process.env)
 * @returns Partial configuration from environment variables
 */
export function parseEnvVars(env: NodeJS.ProcessEnv = process.env): PartialPandoConfig {
  // TODO: Implement environment variable parsing
  // 1. Create empty config object
  // 2. Iterate through all env vars
  // 3. Filter for PANDO_* prefix
  // 4. Check if var is in ENV_VAR_MAP
  // 5. Parse value based on key
  // 6. Set nested property on config
  // 7. Return config object

  const config: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(ENV_PREFIX) || !value) {
      continue
    }

    if (key in ENV_VAR_MAP) {
      const configPath = ENV_VAR_MAP[key]!
      const parsedValue = parseEnvValue(key, value)
      setNestedProperty(config, configPath, parsedValue)
    }
  }

  return config as PartialPandoConfig
}

/**
 * Get configuration from environment variables
 *
 * Convenience function that returns parsed config.
 *
 * @returns Configuration from environment variables
 */
export function getEnvConfig(): PartialPandoConfig {
  return parseEnvVars()
}

/**
 * Check if any PANDO_* environment variables are set
 *
 * @param env - Environment variables object (defaults to process.env)
 * @returns True if any PANDO_* vars exist
 */
export function hasEnvConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  // TODO: Implement env config detection
  // Check if any keys in env start with PANDO_
  return Object.keys(env).some((key) => key.startsWith(ENV_PREFIX))
}

/**
 * List all supported environment variables
 *
 * @returns Array of supported env var names with descriptions
 */
export function listSupportedEnvVars(): Array<{ name: string; path: string; type: string }> {
  return Object.entries(ENV_VAR_MAP).map(([name, path]) => {
    // Determine type based on key patterns
    let type = 'string'

    if (name.includes('FLAGS') || name.includes('EXCLUDE') || name.includes('PATTERNS')) {
      type = 'array'
    } else if (name.includes('ENABLED') || name.includes('RELATIVE') || name.includes('BEFORE')) {
      type = 'boolean'
    }

    return { name, path, type }
  })
}
