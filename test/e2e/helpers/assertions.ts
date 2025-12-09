import { expect } from 'vitest'
import type { PandoResult } from './container.js'

// ============================================================================
// Basic Result Assertions
// ============================================================================

export function expectSuccess(result: PandoResult): void {
  expect(
    result.exitCode,
    `Command failed with stderr: ${result.stderr}\nstdout: ${result.stdout}`
  ).toBe(0)
}

export function expectFailure(result: PandoResult): void {
  expect(result.exitCode).not.toBe(0)
}

// ============================================================================
// JSON Output Assertions
// ============================================================================

export function expectJsonSuccess(result: PandoResult): void {
  expectSuccess(result)
  expect(result.json).toBeDefined()
  // Check for success status in various formats the CLI might use
  const status = result.json?.status ?? result.json?.success
  expect(
    status === 'success' || status === true,
    `Expected success status, got: ${JSON.stringify(result.json)}`
  ).toBe(true)
}

export function expectJsonError(
  result: PandoResult,
  errorContains?: string
): void {
  // Error could be in JSON or in stderr/stdout
  const hasJsonError =
    result.json &&
    (result.json?.error ||
      result.json?.message ||
      result.json?.reason ||
      result.json?.success === false)
  const hasStderrError = result.stderr && result.stderr.length > 0
  const hasExitCodeError = result.exitCode !== 0

  expect(
    hasJsonError || hasStderrError || hasExitCodeError,
    `Expected error response. exitCode: ${result.exitCode}, stderr: ${result.stderr}, json: ${JSON.stringify(result.json)}`
  ).toBe(true)

  if (errorContains) {
    const errorText = [
      result.json?.error,
      result.json?.message,
      result.json?.reason,
      result.stderr,
      result.stdout,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    expect(
      errorText.includes(errorContains.toLowerCase()),
      `Expected error to contain '${errorContains}'. Got: ${errorText}`
    ).toBe(true)
  }
}

export function expectWorktreeCreated(
  result: PandoResult,
  expectedPathContains: string,
  expectedBranch?: string
): void {
  expectSuccess(result)
  expect(result.json).toBeDefined()

  // The worktree info might be under different keys
  const worktree =
    result.json?.worktree ?? result.json?.data?.worktree ?? result.json?.result
  expect(
    worktree,
    `Expected worktree in response: ${JSON.stringify(result.json)}`
  ).toBeDefined()

  const wtPath = (worktree as Record<string, unknown>)?.path as string
  expect(wtPath).toContain(expectedPathContains)

  if (expectedBranch) {
    expect((worktree as Record<string, unknown>)?.branch).toBe(expectedBranch)
  }
}

export function expectWorktreeList(
  result: PandoResult,
  expectedCount: number
): void {
  expectSuccess(result)
  expect(result.json).toBeDefined()

  const worktrees = result.json?.worktrees ?? result.json?.data?.worktrees
  expect(
    worktrees,
    `Expected worktrees array in response: ${JSON.stringify(result.json)}`
  ).toBeDefined()
  expect(Array.isArray(worktrees)).toBe(true)
  expect((worktrees as unknown[]).length).toBe(expectedCount)
}

export function expectConfigCreated(result: PandoResult): void {
  expectSuccess(result)
  expect(result.json).toBeDefined()
  // Config init should indicate file was created
  const action = result.json?.action ?? result.json?.status
  expect(action).toBeDefined()
}

// ============================================================================
// Human-Readable Output Assertions - Generic
// ============================================================================

/**
 * Assert that stdout contains all specified patterns (case-insensitive)
 */
export function expectHumanOutput(
  result: PandoResult,
  patterns: string[]
): void {
  const output = result.stdout.toLowerCase()
  for (const pattern of patterns) {
    expect(
      output.includes(pattern.toLowerCase()),
      `Expected output to contain '${pattern}'.\nActual output:\n${result.stdout}`
    ).toBe(true)
  }
}

/**
 * Assert that output contains a success message indicator (✓ checkmark)
 */
export function expectSuccessMessage(result: PandoResult): void {
  expectSuccess(result)
  expect(
    result.stdout.includes('✓'),
    `Expected success checkmark (✓) in output.\nActual output:\n${result.stdout}`
  ).toBe(true)
}

/**
 * Assert that output contains an error message (✗ or error text)
 */
export function expectErrorMessage(
  result: PandoResult,
  errorPattern?: string
): void {
  const combined = (result.stdout + result.stderr).toLowerCase()
  const hasErrorIndicator =
    result.stdout.includes('✗') ||
    result.stderr.includes('✗') ||
    combined.includes('error') ||
    combined.includes('failed') ||
    combined.includes('not found') ||
    result.exitCode !== 0

  expect(
    hasErrorIndicator,
    `Expected error message in output.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  ).toBe(true)

  if (errorPattern) {
    expect(
      combined.includes(errorPattern.toLowerCase()),
      `Expected error to contain '${errorPattern}'.\nActual:\n${combined}`
    ).toBe(true)
  }
}

// ============================================================================
// Human-Readable Output Assertions - List Command
// ============================================================================

/**
 * Assert worktree list human output format
 * Expected format:
 *   Found 3 worktree(s):
 *
 *     /path/to/worktree
 *       Branch: feature-branch
 *       Commit: abc1234
 */
export function expectWorktreeListHuman(
  result: PandoResult,
  options: {
    minCount?: number
    branches?: string[]
    hasDetachedHead?: boolean
  } = {}
): void {
  expectSuccess(result)
  const output = result.stdout
  const outputLower = output.toLowerCase()

  // Should show "Found X worktree(s):" header
  expect(
    outputLower.includes('found') && outputLower.includes('worktree'),
    `Expected "Found X worktree(s):" header.\nActual output:\n${output}`
  ).toBe(true)

  // Verify count if specified
  if (options.minCount !== undefined) {
    const countMatch = output.match(/Found (\d+) worktree/i)
    expect(countMatch, `Expected worktree count in output.\nActual:\n${output}`).not.toBeNull()
    if (countMatch) {
      const count = parseInt(countMatch[1], 10)
      expect(count).toBeGreaterThanOrEqual(options.minCount)
    }
  }

  // Should show worktree paths (absolute paths starting with /)
  expect(
    output.includes('/'),
    `Expected worktree path (/) in output.\nActual:\n${output}`
  ).toBe(true)

  // Should show "Branch:" label for each worktree
  expect(
    outputLower.includes('branch:'),
    `Expected "Branch:" label in output.\nActual:\n${output}`
  ).toBe(true)

  // Verify specific branches if specified
  if (options.branches) {
    for (const branch of options.branches) {
      expect(
        output.includes(branch),
        `Expected branch '${branch}' in output.\nActual:\n${output}`
      ).toBe(true)
    }
  }

  // Check for detached HEAD if expected
  if (options.hasDetachedHead) {
    expect(
      outputLower.includes('detached head'),
      `Expected "(detached HEAD)" in output.\nActual:\n${output}`
    ).toBe(true)
  }

  // Note: Commit hash is optional in list output (may be hidden for cleaner display)
}

// ============================================================================
// Human-Readable Output Assertions - Add Command
// ============================================================================

/**
 * Assert worktree add human output format
 * Expected format:
 *   ✓ Worktree created at /path/to/worktree
 *     Branch: feature-branch
 *     Commit: abc1234
 *
 *   ✓ Files synced: 42 files (1.23 MB)
 *   ✓ Symlinks created: 3 files
 *
 *   Ready to use: cd /path/to/worktree
 *   Duration: 1.23s
 */
export function expectWorktreeAddHuman(
  result: PandoResult,
  options: {
    pathContains?: string
    branch?: string
    hasRsync?: boolean
    hasSymlinks?: boolean
  } = {}
): void {
  expectSuccess(result)
  const output = result.stdout
  const outputLower = output.toLowerCase()

  // Must have success checkmark
  expect(
    output.includes('✓'),
    `Expected success checkmark (✓) in output.\nActual:\n${output}`
  ).toBe(true)

  // Must show "Worktree created at" message
  expect(
    outputLower.includes('worktree created at'),
    `Expected "Worktree created at" message.\nActual:\n${output}`
  ).toBe(true)

  // Verify path if specified
  if (options.pathContains) {
    expect(
      output.includes(options.pathContains),
      `Expected path containing '${options.pathContains}'.\nActual:\n${output}`
    ).toBe(true)
  }

  // Must show "Branch:" info (unless detached)
  expect(
    outputLower.includes('branch:'),
    `Expected "Branch:" info in output.\nActual:\n${output}`
  ).toBe(true)

  // Verify branch name if specified
  if (options.branch) {
    expect(
      output.includes(options.branch),
      `Expected branch '${options.branch}' in output.\nActual:\n${output}`
    ).toBe(true)
  }

  // Must show "Commit:" info
  expect(
    outputLower.includes('commit:'),
    `Expected "Commit:" info in output.\nActual:\n${output}`
  ).toBe(true)

  // Check rsync output if expected
  if (options.hasRsync) {
    expect(
      outputLower.includes('files synced') || outputLower.includes('synced'),
      `Expected rsync/sync info in output.\nActual:\n${output}`
    ).toBe(true)
  }

  // Check symlink output if expected
  if (options.hasSymlinks) {
    expect(
      outputLower.includes('symlink'),
      `Expected symlink info in output.\nActual:\n${output}`
    ).toBe(true)
  }

  // Must show "Ready to use: cd ..." footer
  expect(
    outputLower.includes('ready to use'),
    `Expected "Ready to use:" footer.\nActual:\n${output}`
  ).toBe(true)

  // Must show duration
  expect(
    outputLower.includes('duration:'),
    `Expected "Duration:" in output.\nActual:\n${output}`
  ).toBe(true)
}

/**
 * Assert worktree add error output
 */
export function expectWorktreeAddError(
  result: PandoResult,
  errorContains: string
): void {
  expectFailure(result)
  const combined = (result.stdout + result.stderr).toLowerCase()

  expect(
    combined.includes(errorContains.toLowerCase()),
    `Expected error containing '${errorContains}'.\nActual:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  ).toBe(true)
}

// ============================================================================
// Human-Readable Output Assertions - Remove Command
// ============================================================================

/**
 * Assert worktree remove human output format
 * Expected format:
 *   ✓ Successfully removed worktree(s):
 *     /path/to/worktree (branch-name)
 *       ↳ Local branch 'branch-name' deleted
 */
export function expectWorktreeRemoveHuman(
  result: PandoResult,
  options: {
    pathContains?: string
    branchDeleted?: string
  } = {}
): void {
  expectSuccess(result)
  const output = result.stdout
  const outputLower = output.toLowerCase()

  // Must have success checkmark
  expect(
    output.includes('✓'),
    `Expected success checkmark (✓) in output.\nActual:\n${output}`
  ).toBe(true)

  // Must show "removed" message
  expect(
    outputLower.includes('removed'),
    `Expected "removed" in output.\nActual:\n${output}`
  ).toBe(true)

  // Verify path if specified
  if (options.pathContains) {
    expect(
      output.includes(options.pathContains),
      `Expected path containing '${options.pathContains}'.\nActual:\n${output}`
    ).toBe(true)
  }

  // Check branch deletion message if expected
  if (options.branchDeleted) {
    expect(
      outputLower.includes('branch') && outputLower.includes('deleted'),
      `Expected branch deletion message.\nActual:\n${output}`
    ).toBe(true)
    expect(
      output.includes(options.branchDeleted),
      `Expected branch name '${options.branchDeleted}' in output.\nActual:\n${output}`
    ).toBe(true)
  }
}

// ============================================================================
// Human-Readable Output Assertions - Symlink Command
// ============================================================================

/**
 * Assert symlink command human output format
 * Expected format (success):
 *   ✓ Moved file.txt to main worktree
 *     Source: /path/to/worktree/file.txt
 *     Dest:   /path/to/main/file.txt
 *   ✓ Created symlink
 *
 * Expected format (dry-run):
 *   Dry run:
 *     Move: /path/to/file.txt
 *       To: /path/to/main/file.txt
 *     Link: /path/to/file.txt -> /path/to/main/file.txt
 */
export function expectSymlinkHuman(
  result: PandoResult,
  options: {
    fileName?: string
    isDryRun?: boolean
  } = {}
): void {
  expectSuccess(result)
  const output = result.stdout
  const outputLower = output.toLowerCase()

  if (options.isDryRun) {
    // Dry run output format
    expect(
      outputLower.includes('dry run'),
      `Expected "Dry run:" prefix.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('move:'),
      `Expected "Move:" in dry run output.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('to:'),
      `Expected "To:" in dry run output.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('link:'),
      `Expected "Link:" in dry run output.\nActual:\n${output}`
    ).toBe(true)
  } else {
    // Success output format
    expect(
      output.includes('✓'),
      `Expected success checkmark (✓) in output.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('moved'),
      `Expected "Moved" in output.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('source:'),
      `Expected "Source:" in output.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('dest:'),
      `Expected "Dest:" in output.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('created symlink'),
      `Expected "Created symlink" in output.\nActual:\n${output}`
    ).toBe(true)
  }

  // Verify file name if specified
  if (options.fileName) {
    expect(
      output.includes(options.fileName),
      `Expected file name '${options.fileName}' in output.\nActual:\n${output}`
    ).toBe(true)
  }
}

// ============================================================================
// Human-Readable Output Assertions - Config Init Command
// ============================================================================

/**
 * Assert config init human output format
 * Expected format (create):
 *   ✓ Configuration file created: /path/to/.pando.toml
 *
 *   Next steps:
 *     1. Edit the file to customize your settings
 *     2. Run `pando config show` to verify configuration
 *     3. This config will be automatically discovered for this project
 *
 * Expected format (merge):
 *   ✓ Configuration updated: /path/to/.pando.toml
 *
 *   Added 3 missing setting(s):
 *     • rsync.enabled = true
 */
export function expectConfigInitHuman(
  result: PandoResult,
  options: {
    action?: 'created' | 'updated' | 'merged'
    pathContains?: string
    hasMergeDetails?: boolean
  } = {}
): void {
  expectSuccess(result)
  const output = result.stdout
  const outputLower = output.toLowerCase()

  // Must have success checkmark
  expect(
    output.includes('✓'),
    `Expected success checkmark (✓) in output.\nActual:\n${output}`
  ).toBe(true)

  // Must show "Configuration file" message
  expect(
    outputLower.includes('configuration'),
    `Expected "Configuration" in output.\nActual:\n${output}`
  ).toBe(true)

  // Must show .pando.toml path
  expect(
    output.includes('.pando.toml'),
    `Expected ".pando.toml" in output.\nActual:\n${output}`
  ).toBe(true)

  // Verify path if specified
  if (options.pathContains) {
    expect(
      output.includes(options.pathContains),
      `Expected path containing '${options.pathContains}'.\nActual:\n${output}`
    ).toBe(true)
  }

  // Check action word if specified
  if (options.action) {
    expect(
      outputLower.includes(options.action),
      `Expected action '${options.action}' in output.\nActual:\n${output}`
    ).toBe(true)
  }

  // Check for "Next steps:" section (for create action)
  if (!options.hasMergeDetails) {
    expect(
      outputLower.includes('next steps'),
      `Expected "Next steps:" section.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('edit the file'),
      `Expected "Edit the file" instruction.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('pando config show'),
      `Expected "pando config show" instruction.\nActual:\n${output}`
    ).toBe(true)
  }

  // Check for merge details if expected
  if (options.hasMergeDetails) {
    expect(
      outputLower.includes('added') && outputLower.includes('setting'),
      `Expected "Added X missing setting(s)" in merge output.\nActual:\n${output}`
    ).toBe(true)
  }
}

// ============================================================================
// Human-Readable Output Assertions - Config Show Command
// ============================================================================

/**
 * Assert config show human output format
 * Expected format:
 *   Configuration (merged from 2 sources):
 *
 *   [rsync]
 *     enabled = true
 *     flags = ["--archive","--exclude",".git"]
 *     exclude = []
 *
 *   [symlink]
 *     patterns = []
 *     relative = true
 *     beforeRsync = true
 *
 *   Configuration sources (priority order):
 *     1. /path/to/.pando.toml
 *     2. defaults
 */
export function expectConfigShowHuman(
  result: PandoResult,
  options: {
    sections?: string[]
    showSources?: boolean
    customValues?: Record<string, unknown>
  } = {}
): void {
  expectSuccess(result)
  const output = result.stdout
  const outputLower = output.toLowerCase()

  // Must show "Configuration" header
  expect(
    outputLower.includes('configuration'),
    `Expected "Configuration" header.\nActual:\n${output}`
  ).toBe(true)

  // Default sections to check
  const sectionsToCheck = options.sections || ['rsync', 'symlink']

  for (const section of sectionsToCheck) {
    expect(
      output.includes(`[${section}]`),
      `Expected section "[${section}]" in output.\nActual:\n${output}`
    ).toBe(true)
  }

  // rsync section should have enabled, flags, exclude
  if (sectionsToCheck.includes('rsync')) {
    expect(
      outputLower.includes('enabled'),
      `Expected "enabled" setting in rsync section.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('flags'),
      `Expected "flags" setting in rsync section.\nActual:\n${output}`
    ).toBe(true)
  }

  // symlink section should have patterns, relative
  if (sectionsToCheck.includes('symlink')) {
    expect(
      outputLower.includes('patterns'),
      `Expected "patterns" setting in symlink section.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('relative'),
      `Expected "relative" setting in symlink section.\nActual:\n${output}`
    ).toBe(true)
  }

  // Check for sources section if expected
  if (options.showSources) {
    expect(
      outputLower.includes('sources') || outputLower.includes('priority'),
      `Expected "Configuration sources" section.\nActual:\n${output}`
    ).toBe(true)

    expect(
      outputLower.includes('defaults'),
      `Expected "defaults" in sources.\nActual:\n${output}`
    ).toBe(true)
  }

  // Check custom values if specified
  if (options.customValues) {
    for (const [key, value] of Object.entries(options.customValues)) {
      const valueStr = String(value)
      expect(
        output.includes(valueStr),
        `Expected custom value '${valueStr}' for '${key}' in output.\nActual:\n${output}`
      ).toBe(true)
    }
  }
}

/**
 * Assert config output shows expected sections (simpler version)
 */
export function expectConfigSections(
  result: PandoResult,
  sections: string[]
): void {
  expectSuccess(result)
  const output = result.stdout

  for (const section of sections) {
    expect(
      output.includes(`[${section}]`),
      `Expected config section '[${section}]'.\nActual output:\n${output}`
    ).toBe(true)
  }
}
