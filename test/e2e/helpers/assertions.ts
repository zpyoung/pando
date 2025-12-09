import { expect } from 'vitest'
import type { PandoResult } from './container.js'

export function expectSuccess(result: PandoResult): void {
  expect(
    result.exitCode,
    `Command failed with stderr: ${result.stderr}\nstdout: ${result.stdout}`
  ).toBe(0)
}

export function expectFailure(result: PandoResult): void {
  expect(result.exitCode).not.toBe(0)
}

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
  const hasJsonError = result.json && (
    result.json?.error ||
    result.json?.message ||
    result.json?.reason ||
    result.json?.success === false
  )
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
      result.stdout
    ].filter(Boolean).join(' ').toLowerCase()

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
  expect(worktree, `Expected worktree in response: ${JSON.stringify(result.json)}`).toBeDefined()

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
  expect(worktrees, `Expected worktrees array in response: ${JSON.stringify(result.json)}`).toBeDefined()
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
