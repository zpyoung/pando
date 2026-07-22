import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  PandoConfigSchema,
  PartialPandoConfigSchema,
} from '../../src/config/schema'

describe('configuration schema', () => {
  it('applies the lifecycle defaults from empty section objects', () => {
    const config = PandoConfigSchema.parse({
      rsync: {},
      symlink: {},
      worktree: {},
      clean: {},
      reap: {},
      concurrency: { retry: {} },
      ports: {},
    })

    expect(config).toEqual(DEFAULT_CONFIG)
    expect(config.worktree).toMatchObject({
      defaultKind: 'auto',
      ephemeralTtl: '4h',
      autoLockActive: true,
    })
    expect(config.reap).toEqual({ requireMerged: true })
    expect(config.concurrency).toEqual({
      retry: { maxAttempts: 5, baseMs: 100, capMs: 2000 },
    })
    expect(config.ports).toEqual({
      enabled: false,
      range: '3100-3199',
      names: ['web'],
      dbStrategy: 'named',
      dbBaseName: 'dev',
    })
  })

  it('accepts a partial ports object without applying defaults', () => {
    expect(PartialPandoConfigSchema.parse({ ports: { range: '4100-4199' } })).toEqual({
      ports: { range: '4100-4199' },
    })
  })
})
