/**
 * Validation utilities for user-supplied identifiers.
 *
 * Currently focused on git branch names. The rules implement the most common
 * `git check-ref-format` constraints so that obviously-invalid names are
 * rejected up front with a clear message instead of producing a cryptic git
 * error (or, worse, being used unescaped somewhere downstream).
 */

/**
 * Result of validating a branch name.
 */
export interface BranchNameValidationResult {
  /** Whether the name passed all checks */
  valid: boolean
  /** Human-readable reason the name is invalid (only set when `valid` is false) */
  reason?: string
}

/**
 * Characters that git disallows anywhere in a ref name.
 * (space, ~, ^, :, ?, *, [, backslash)
 */
const FORBIDDEN_CHARACTERS = ['~', '^', ':', '?', '*', '[', '\\']

/**
 * Validate a git branch name against the core `git check-ref-format` rules.
 *
 * Rejects names that are:
 * - empty
 * - contain whitespace or ASCII control characters
 * - contain a `..` sequence
 * - contain any of: ~ ^ : ? * [ \
 * - contain the `@{` sequence
 * - are exactly `@`
 * - begin with `-`, `.`, or `/`
 * - end with `/`, `.`, or `.lock`
 *
 * @param name - The branch name to validate
 * @returns A result indicating validity and, when invalid, the reason
 */
export function validateBranchName(name: string): BranchNameValidationResult {
  if (name.length === 0) {
    return { valid: false, reason: 'Branch name cannot be empty.' }
  }

  // No whitespace or ASCII control characters (covers spaces, tabs, newlines,
  // and other control chars that git forbids in ref names).
  for (const char of name) {
    const code = char.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) {
      return {
        valid: false,
        reason: 'Branch name cannot contain whitespace or control characters.',
      }
    }
    if (char === ' ') {
      return {
        valid: false,
        reason: 'Branch name cannot contain whitespace or control characters.',
      }
    }
  }

  if (name.includes('..')) {
    return { valid: false, reason: "Branch name cannot contain '..'." }
  }

  for (const forbidden of FORBIDDEN_CHARACTERS) {
    if (name.includes(forbidden)) {
      return {
        valid: false,
        reason: `Branch name cannot contain '${forbidden}'.`,
      }
    }
  }

  if (name.includes('@{')) {
    return { valid: false, reason: "Branch name cannot contain '@{'." }
  }

  if (name === '@') {
    return { valid: false, reason: "Branch name cannot be a single '@'." }
  }

  if (name.startsWith('-')) {
    return { valid: false, reason: "Branch name cannot begin with '-'." }
  }
  if (name.startsWith('.')) {
    return { valid: false, reason: "Branch name cannot begin with '.'." }
  }
  if (name.startsWith('/')) {
    return { valid: false, reason: "Branch name cannot begin with '/'." }
  }

  if (name.endsWith('/')) {
    return { valid: false, reason: "Branch name cannot end with '/'." }
  }
  if (name.endsWith('.')) {
    return { valid: false, reason: "Branch name cannot end with '.'." }
  }
  if (name.endsWith('.lock')) {
    return { valid: false, reason: "Branch name cannot end with '.lock'." }
  }

  return { valid: true }
}
