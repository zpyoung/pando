import { describe, it, expect } from 'vitest'
import {
  parseBoolean,
  parseArray,
  setNestedProperty,
  parseEnvValue,
  parseEnvVars,
  hasEnvConfig,
  listSupportedEnvVars,
  getEnvConfig,
} from '../../src/config/env'

/**
 * Tests for environment variable parsing utilities
 */

describe('parseBoolean', () => {
  it('should parse "true" as true', () => {
    expect(parseBoolean('true')).toBe(true)
  })

  it('should parse "True" (case insensitive) as true', () => {
    expect(parseBoolean('True')).toBe(true)
  })

  it('should parse "TRUE" as true', () => {
    expect(parseBoolean('TRUE')).toBe(true)
  })

  it('should parse "1" as true', () => {
    expect(parseBoolean('1')).toBe(true)
  })

  it('should parse "yes" as true', () => {
    expect(parseBoolean('yes')).toBe(true)
  })

  it('should parse "Yes" as true', () => {
    expect(parseBoolean('Yes')).toBe(true)
  })

  it('should parse "false" as false', () => {
    expect(parseBoolean('false')).toBe(false)
  })

  it('should parse "0" as false', () => {
    expect(parseBoolean('0')).toBe(false)
  })

  it('should parse "no" as false', () => {
    expect(parseBoolean('no')).toBe(false)
  })

  it('should parse random string as false', () => {
    expect(parseBoolean('random')).toBe(false)
  })

  it('should handle whitespace', () => {
    expect(parseBoolean('  true  ')).toBe(true)
    expect(parseBoolean('  false  ')).toBe(false)
  })
})

describe('parseArray', () => {
  it('should parse comma-separated values', () => {
    expect(parseArray('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('should trim whitespace from values', () => {
    expect(parseArray('a, b , c')).toEqual(['a', 'b', 'c'])
  })

  it('should filter out empty strings', () => {
    expect(parseArray('a,,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('should handle single value', () => {
    expect(parseArray('single')).toEqual(['single'])
  })

  it('should handle empty string', () => {
    expect(parseArray('')).toEqual([])
  })

  it('should handle only commas', () => {
    expect(parseArray(',,,,')).toEqual([])
  })

  it('should handle values with special characters', () => {
    expect(parseArray('--archive,--exclude,*.node_modules')).toEqual([
      '--archive',
      '--exclude',
      '*.node_modules',
    ])
  })

  it('should handle spaces around commas', () => {
    expect(parseArray('a , b , c')).toEqual(['a', 'b', 'c'])
  })
})

describe('setNestedProperty', () => {
  it('should set top-level property', () => {
    const obj = {}
    setNestedProperty(obj, 'key', 'value')
    expect(obj).toEqual({ key: 'value' })
  })

  it('should set nested property', () => {
    const obj = {}
    setNestedProperty(obj, 'rsync.enabled', true)
    expect(obj).toEqual({ rsync: { enabled: true } })
  })

  it('should set deeply nested property', () => {
    const obj = {}
    setNestedProperty(obj, 'a.b.c.d', 'deep')
    expect(obj).toEqual({ a: { b: { c: { d: 'deep' } } } })
  })

  it('should overwrite existing property', () => {
    const obj = { rsync: { enabled: false } }
    setNestedProperty(obj, 'rsync.enabled', true)
    expect(obj).toEqual({ rsync: { enabled: true } })
  })

  it('should preserve sibling properties', () => {
    const obj = { rsync: { flags: ['--archive'] } }
    setNestedProperty(obj, 'rsync.enabled', true)
    expect(obj).toEqual({
      rsync: {
        flags: ['--archive'],
        enabled: true,
      },
    })
  })

  it('should handle array values', () => {
    const obj = {}
    setNestedProperty(obj, 'rsync.flags', ['--archive', '--exclude'])
    expect(obj).toEqual({ rsync: { flags: ['--archive', '--exclude'] } })
  })

  it('should handle boolean values', () => {
    const obj = {}
    setNestedProperty(obj, 'symlink.relative', true)
    expect(obj).toEqual({ symlink: { relative: true } })
  })
})

describe('parseEnvValue', () => {
  it('should parse FLAGS as array', () => {
    expect(parseEnvValue('PANDO_RSYNC_FLAGS', 'a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('should parse EXCLUDE as array', () => {
    expect(parseEnvValue('PANDO_RSYNC_EXCLUDE', 'x,y,z')).toEqual(['x', 'y', 'z'])
  })

  it('should parse PATTERNS as array', () => {
    expect(parseEnvValue('PANDO_SYMLINK_PATTERNS', '*.json,*.lock')).toEqual(['*.json', '*.lock'])
  })

  it('should parse ENABLED as boolean', () => {
    expect(parseEnvValue('PANDO_RSYNC_ENABLED', 'true')).toBe(true)
    expect(parseEnvValue('PANDO_RSYNC_ENABLED', 'false')).toBe(false)
  })

  it('should parse RELATIVE as boolean', () => {
    expect(parseEnvValue('PANDO_SYMLINK_RELATIVE', '1')).toBe(true)
    expect(parseEnvValue('PANDO_SYMLINK_RELATIVE', '0')).toBe(false)
  })

  it('should parse BEFORE as boolean', () => {
    expect(parseEnvValue('PANDO_SYMLINK_BEFORE_RSYNC', 'yes')).toBe(true)
    expect(parseEnvValue('PANDO_SYMLINK_BEFORE_RSYNC', 'no')).toBe(false)
  })

  it('should parse USE_ as boolean', () => {
    expect(parseEnvValue('PANDO_WORKTREE_USE_PROJECT_SUBFOLDER', 'true')).toBe(true)
    expect(parseEnvValue('PANDO_WORKTREE_USE_PROJECT_SUBFOLDER', 'false')).toBe(false)
  })

  it('should return string for unknown keys', () => {
    expect(parseEnvValue('PANDO_UNKNOWN_KEY', 'value')).toBe('value')
  })
})

describe('parseEnvVars', () => {
  it('should parse empty environment', () => {
    expect(parseEnvVars({})).toEqual({})
  })

  it('should ignore non-PANDO variables', () => {
    expect(parseEnvVars({ PATH: '/usr/bin', HOME: '/home/user' })).toEqual({})
  })

  it('should parse single rsync variable', () => {
    const env = { PANDO_RSYNC_ENABLED: 'true' }
    expect(parseEnvVars(env)).toEqual({
      rsync: { enabled: true },
    })
  })

  it('should parse multiple rsync variables', () => {
    const env = {
      PANDO_RSYNC_ENABLED: 'true',
      PANDO_RSYNC_FLAGS: '--archive,--verbose',
      PANDO_RSYNC_EXCLUDE: 'node_modules,dist',
    }
    expect(parseEnvVars(env)).toEqual({
      rsync: {
        enabled: true,
        flags: ['--archive', '--verbose'],
        exclude: ['node_modules', 'dist'],
      },
    })
  })

  it('should parse symlink variables', () => {
    const env = {
      PANDO_SYMLINK_PATTERNS: '*.json,*.lock',
      PANDO_SYMLINK_RELATIVE: 'true',
      PANDO_SYMLINK_BEFORE_RSYNC: 'false',
    }
    expect(parseEnvVars(env)).toEqual({
      symlink: {
        patterns: ['*.json', '*.lock'],
        relative: true,
        beforeRsync: false,
      },
    })
  })

  it('should parse worktree variables', () => {
    const env = {
      PANDO_WORKTREE_DEFAULT_PATH: '../worktrees',
    }
    expect(parseEnvVars(env)).toEqual({
      worktree: {
        defaultPath: '../worktrees',
      },
    })
  })

  it('should parse worktree useProjectSubfolder', () => {
    const env = {
      PANDO_WORKTREE_USE_PROJECT_SUBFOLDER: 'true',
    }
    expect(parseEnvVars(env)).toEqual({
      worktree: {
        useProjectSubfolder: true,
      },
    })
  })

  it('should parse mixed variables', () => {
    const env = {
      PANDO_RSYNC_ENABLED: 'true',
      PANDO_SYMLINK_PATTERNS: '*.json',
      PATH: '/usr/bin', // Should be ignored
    }
    expect(parseEnvVars(env)).toEqual({
      rsync: { enabled: true },
      symlink: { patterns: ['*.json'] },
    })
  })

  it('should ignore unsupported PANDO variables', () => {
    const env = {
      PANDO_UNSUPPORTED: 'value',
      PANDO_RSYNC_ENABLED: 'true',
    }
    expect(parseEnvVars(env)).toEqual({
      rsync: { enabled: true },
    })
  })

  it('should ignore empty string values', () => {
    const env = {
      PANDO_RSYNC_ENABLED: '',
      PANDO_RSYNC_FLAGS: '--archive',
    }
    expect(parseEnvVars(env)).toEqual({
      rsync: { flags: ['--archive'] },
    })
  })

  it('should handle all supported variables', () => {
    const env = {
      PANDO_RSYNC_ENABLED: 'true',
      PANDO_RSYNC_FLAGS: '--archive',
      PANDO_RSYNC_EXCLUDE: 'node_modules',
      PANDO_SYMLINK_PATTERNS: '*.json',
      PANDO_SYMLINK_RELATIVE: 'false',
      PANDO_SYMLINK_BEFORE_RSYNC: 'true',
      PANDO_WORKTREE_DEFAULT_PATH: '../worktrees',
    }
    expect(parseEnvVars(env)).toEqual({
      rsync: {
        enabled: true,
        flags: ['--archive'],
        exclude: ['node_modules'],
      },
      symlink: {
        patterns: ['*.json'],
        relative: false,
        beforeRsync: true,
      },
      worktree: {
        defaultPath: '../worktrees',
      },
    })
  })
})

describe('hasEnvConfig', () => {
  it('should return false for empty environment', () => {
    expect(hasEnvConfig({})).toBe(false)
  })

  it('should return false for environment without PANDO variables', () => {
    expect(hasEnvConfig({ PATH: '/usr/bin', HOME: '/home/user' })).toBe(false)
  })

  it('should return true when PANDO variables exist', () => {
    expect(hasEnvConfig({ PANDO_RSYNC_ENABLED: 'true' })).toBe(true)
  })

  it('should return true for any PANDO prefixed variable', () => {
    expect(hasEnvConfig({ PANDO_CUSTOM: 'value' })).toBe(true)
  })

  it('should return true when mixed with other variables', () => {
    expect(hasEnvConfig({ PATH: '/usr/bin', PANDO_RSYNC_ENABLED: 'true' })).toBe(true)
  })
})

describe('listSupportedEnvVars', () => {
  it('should return array of supported variables', () => {
    const vars = listSupportedEnvVars()
    expect(Array.isArray(vars)).toBe(true)
    expect(vars.length).toBeGreaterThan(0)
  })

  it('should include all expected variables', () => {
    const vars = listSupportedEnvVars()
    const names = vars.map((v) => v.name)

    expect(names).toContain('PANDO_RSYNC_ENABLED')
    expect(names).toContain('PANDO_RSYNC_FLAGS')
    expect(names).toContain('PANDO_RSYNC_EXCLUDE')
    expect(names).toContain('PANDO_SYMLINK_PATTERNS')
    expect(names).toContain('PANDO_SYMLINK_RELATIVE')
    expect(names).toContain('PANDO_SYMLINK_BEFORE_RSYNC')
    expect(names).toContain('PANDO_WORKTREE_USE_PROJECT_SUBFOLDER')
  })

  it('should include config paths', () => {
    const vars = listSupportedEnvVars()
    const rsyncEnabled = vars.find((v) => v.name === 'PANDO_RSYNC_ENABLED')

    expect(rsyncEnabled).toBeDefined()
    expect(rsyncEnabled?.path).toBe('rsync.enabled')
  })

  it('should include type information', () => {
    const vars = listSupportedEnvVars()

    expect(vars.every((v) => v.type)).toBe(true)
    expect(vars.every((v) => typeof v.type === 'string')).toBe(true)
  })

  it('should correctly identify array types', () => {
    const vars = listSupportedEnvVars()
    const flags = vars.find((v) => v.name === 'PANDO_RSYNC_FLAGS')

    expect(flags).toBeDefined()
    expect(flags?.type).toBe('array')
  })

  it('should correctly identify boolean types', () => {
    const vars = listSupportedEnvVars()
    const enabled = vars.find((v) => v.name === 'PANDO_RSYNC_ENABLED')

    expect(enabled).toBeDefined()
    expect(enabled?.type).toBe('boolean')
  })
})

describe('getEnvConfig', () => {
  it('should be a convenience wrapper for parseEnvVars', () => {
    // Since getEnvConfig uses process.env, we just verify it returns an object
    const config = getEnvConfig()
    expect(typeof config).toBe('object')
  })
})
