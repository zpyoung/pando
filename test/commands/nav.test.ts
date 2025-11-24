import { describe, it, expect } from 'vitest'
import NavCommand from '../../src/commands/nav'
import NavigateCommand from '../../src/commands/navigate'

/**
 * Tests for nav command (alias for navigate)
 *
 * These tests verify that nav is a proper alias for navigate
 */

describe('nav', () => {
  it('should be the same class as navigate command', () => {
    // The nav command should be a direct re-export of navigate
    expect(NavCommand).toBe(NavigateCommand)
  })

  it('should have the same description as navigate', () => {
    expect(NavCommand.description).toBe(NavigateCommand.description)
    expect(NavCommand.description).toBe('Navigate to a git worktree')
  })

  it('should have the same flags as navigate', () => {
    expect(NavCommand.flags).toEqual(NavigateCommand.flags)
    expect(NavCommand.flags).toHaveProperty('branch')
    expect(NavCommand.flags).toHaveProperty('path')
    expect(NavCommand.flags).toHaveProperty('json')
    expect(NavCommand.flags).toHaveProperty('output-path')
  })

  it('should have the same examples as navigate', () => {
    expect(NavCommand.examples).toEqual(NavigateCommand.examples)
    expect(NavCommand.examples).toHaveLength(3)
  })
})
