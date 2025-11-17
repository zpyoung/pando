import type { Command } from '@oclif/core'

/**
 * Error Helper Utility
 *
 * Provides centralized error handling for the Pando CLI with proper
 * stack trace control and JSON output support.
 *
 * Usage Guidelines:
 * - Use `validation()` for expected user errors (wrong input, file exists, etc.)
 * - Use `operation()` for runtime failures (network, permissions, etc.)
 * - Use `unexpected()` for internal errors/bugs that should show stack traces
 *
 * @example
 * // Validation error (clean output, no stack trace)
 * ErrorHelper.validation(this, 'File already exists', flags.json)
 *
 * @example
 * // Operation error (contextual message)
 * try {
 *   await dangerousOperation()
 * } catch (error) {
 *   ErrorHelper.operation(this, error, 'Failed to create worktree', flags.json)
 * }
 *
 * @example
 * // Unexpected error (show stack trace for debugging)
 * if (!criticalDependency) {
 *   ErrorHelper.unexpected(this, new Error('Critical dependency not initialized'))
 * }
 */
export class ErrorHelper {
  /**
   * Handle validation errors (user input, preconditions, etc.)
   *
   * These are expected errors that should display clean messages without
   * stack traces. Examples: file already exists, invalid arguments,
   * missing required configuration.
   *
   * @param command - The oclif command instance
   * @param message - Clear, user-friendly error message
   * @param json - Whether to output JSON format (from --json flag)
   * @returns Never returns (exits process)
   *
   * @example
   * // Simple validation error
   * if (await fs.pathExists(configPath) && !flags.force) {
   *   ErrorHelper.validation(
   *     this,
   *     `Configuration file already exists: ${configPath}\nUse --force to overwrite`,
   *     flags.json
   *   )
   * }
   */
  static validation(command: Command, message: string, json?: boolean): never {
    if (json) {
      command.log(
        JSON.stringify(
          {
            status: 'error',
            error: message,
          },
          null,
          2
        )
      )
      command.exit(1)
    } else {
      // Use { exit: false } to prevent stack trace display
      command.error(message, { exit: false })
      command.exit(1)
    }
  }

  /**
   * Handle operation errors (runtime failures, external dependencies)
   *
   * These are errors from operations that may fail due to external factors
   * like network issues, permissions, disk space, etc. The context parameter
   * helps users understand what operation failed.
   *
   * @param command - The oclif command instance
   * @param error - The caught error object
   * @param context - Description of what operation failed
   * @param json - Whether to output JSON format (from --json flag)
   * @returns Never returns (exits process)
   *
   * @example
   * // Wrap risky operations
   * try {
   *   await gitHelper.addWorktree(path, options)
   * } catch (error) {
   *   ErrorHelper.operation(
   *     this,
   *     error as Error,
   *     'Failed to create worktree',
   *     flags.json
   *   )
   * }
   */
  static operation(command: Command, error: Error, context: string, json?: boolean): never {
    const message = `${context}: ${error.message}`

    if (json) {
      command.log(
        JSON.stringify(
          {
            status: 'error',
            error: message,
            context,
            details: error.message,
          },
          null,
          2
        )
      )
      command.exit(1)
    } else {
      // Use { exit: false } to prevent stack trace display
      command.error(message, { exit: false })
      command.exit(1)
    }
  }

  /**
   * Handle unexpected errors (bugs, internal errors)
   *
   * These are errors that should never happen in normal operation and
   * indicate a bug in the code. Stack traces are shown to help debugging.
   * Use sparingly - most errors should be validation or operation errors.
   *
   * @param command - The oclif command instance
   * @param error - The error object
   * @returns Never returns (exits process with stack trace)
   *
   * @example
   * // Internal consistency check
   * if (!this.criticalState) {
   *   ErrorHelper.unexpected(
   *     this,
   *     new Error('Critical state not initialized - this is a bug')
   *   )
   * }
   */
  static unexpected(command: Command, error: Error): never {
    // Let oclif display the full stack trace
    command.error(error.message)
  }

  /**
   * Warn the user without exiting
   *
   * Use for non-fatal issues that the user should know about but
   * don't prevent the operation from completing.
   *
   * @param command - The oclif command instance
   * @param message - Warning message
   * @param json - Whether to output JSON format (from --json flag)
   *
   * @example
   * // Warn about deprecation
   * ErrorHelper.warn(
   *   this,
   *   'The --old-flag is deprecated. Use --new-flag instead.',
   *   flags.json
   * )
   */
  static warn(command: Command, message: string, json?: boolean): void {
    if (json) {
      command.log(
        JSON.stringify(
          {
            status: 'warning',
            warning: message,
          },
          null,
          2
        )
      )
    } else {
      command.warn(message)
    }
  }
}
