import { Flags } from '@oclif/core'

/**
 * Common CLI flags shared across multiple commands
 *
 * This module provides standardized flag definitions to ensure
 * consistent behavior and documentation across all commands.
 */

/**
 * JSON output flag
 * Enables structured JSON output instead of human-readable format
 */
export const jsonFlag = Flags.boolean({
  char: 'j',
  description: 'Output result in JSON format',
  default: false,
})

/**
 * Force operation flag
 * Bypasses safety checks and confirmation prompts
 */
export const forceFlag = Flags.boolean({
  char: 'f',
  description: 'Force the operation without confirmation',
  default: false,
})

/**
 * Path flag
 * Specifies a path for the operation (can be relative or absolute)
 */
export const pathFlag = Flags.string({
  char: 'p',
  description: 'Path for the operation',
  required: false,
})

/**
 * Common flags object for easy spreading
 * Use when you want to include all common flags in a command
 */
export const commonFlags = {
  json: jsonFlag,
  path: pathFlag,
}

/**
 * Helper function to combine common flags with command-specific flags
 * Simplifies flag definitions by merging common and custom flags
 *
 * @param customFlags - Command-specific flags to merge with common flags
 * @returns Combined flags object
 *
 * @example
 * ```typescript
 * static flags = withCommonFlags({
 *   name: Flags.string({ required: true }),
 *   path: Flags.string({ required: false }),
 * })
 * ```
 */
export function withCommonFlags<T extends Record<string, unknown>>(
  customFlags: T
): Record<string, unknown> {
  return {
    ...commonFlags,
    ...customFlags,
  }
}
