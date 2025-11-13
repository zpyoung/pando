/**
 * Test utilities and helpers for pando tests
 *
 * Provides common fixtures, mocks, and utilities for testing
 * command behavior and git operations.
 */

/**
 * Mock worktree data for testing
 */
export const mockWorktrees = [
  {
    path: '/path/to/main',
    branch: 'main',
    commit: 'abc123',
    isPrunable: false,
  },
  {
    path: '/path/to/feature-x',
    branch: 'feature-x',
    commit: 'def456',
    isPrunable: false,
  },
]

/**
 * Mock branch data for testing
 */
export const mockBranches = [
  {
    name: 'main',
    current: true,
    commit: 'abc123',
    label: 'Initial commit',
  },
  {
    name: 'feature-x',
    current: false,
    commit: 'def456',
    label: 'Add feature X',
  },
]

/**
 * Create a mock GitHelper instance for testing
 * TODO: Implement mock GitHelper with configurable responses
 */
export function createMockGitHelper() {
  // TODO: Create mock implementation
  // Use vitest.fn() to create spies
  // Return object with all GitHelper methods mocked
  throw new Error('Not implemented')
}

/**
 * Set up a temporary git repository for integration tests
 * TODO: Implement temp repo creation
 */
export async function setupTempRepo() {
  // TODO: Create temp directory
  // TODO: Initialize git repo
  // TODO: Create initial commit
  // TODO: Return repo path and cleanup function
  throw new Error('Not implemented')
}

/**
 * Clean up test artifacts
 * TODO: Implement cleanup utilities
 */
export async function cleanupTestRepo(_path: string) {
  // TODO: Remove temp directory safely
  throw new Error('Not implemented')
}
