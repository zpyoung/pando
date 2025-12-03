import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WorktreeSetupOrchestrator,
  SetupPhase,
  SetupError,
  type SetupOptions,
} from '../../src/utils/worktreeSetup'
import type { GitHelper } from '../../src/utils/git'
import type { PandoConfig } from '../../src/config/schema'
import {
  RsyncHelper,
  SymlinkHelper,
  FileOperationTransaction,
  RsyncNotInstalledError,
  type RsyncResult,
  type SymlinkResult,
} from '../../src/utils/fileOps'

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra')
  return {
    ...actual,
    default: {
      ...actual,
      pathExists: vi.fn(),
      stat: vi.fn(),
      remove: vi.fn(),
    },
    pathExists: vi.fn(),
    stat: vi.fn(),
    remove: vi.fn(),
  }
})

vi.mock('../../src/utils/fileOps', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/utils/fileOps')>('../../src/utils/fileOps')
  return {
    ...actual,
    createRsyncHelper: vi.fn(),
    createSymlinkHelper: vi.fn(),
  }
})

// ============================================================================
// Test Suite
// ============================================================================

describe('WorktreeSetupOrchestrator', () => {
  let orchestrator: WorktreeSetupOrchestrator
  let mockGitHelper: GitHelper
  let mockConfig: PandoConfig
  let mockRsyncHelper: RsyncHelper
  let mockSymlinkHelper: SymlinkHelper
  let mockTransaction: FileOperationTransaction
  let mockPathExists: ReturnType<typeof vi.fn>
  let mockStat: ReturnType<typeof vi.fn>
  let mockRemove: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // Get reference to mocked fs-extra
    const fsExtra = await import('fs-extra')
    mockPathExists = fsExtra.pathExists as any
    mockStat = (fsExtra as any).stat
    mockRemove = (fsExtra as any).remove
    vi.mocked(mockPathExists).mockReset()
    vi.mocked(mockStat).mockReset()
    vi.mocked(mockRemove).mockReset()

    // Create mock GitHelper
    mockGitHelper = {
      getMainWorktreePath: vi.fn().mockResolvedValue('/repo/main'),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
    } as any

    // Create mock config
    mockConfig = {
      rsync: {
        enabled: true,
        flags: ['-av', '--delete'],
        exclude: ['node_modules', '.git'],
      },
      symlink: {
        enabled: true,
        beforeRsync: true,
        patterns: ['package.json', 'pnpm-lock.yaml'],
      },
    } as PandoConfig

    // Create mock transaction
    mockTransaction = {
      record: vi.fn(),
      createCheckpoint: vi.fn(),
      getCheckpoint: vi.fn().mockReturnValue(undefined),
      getOperations: vi.fn().mockReturnValue([]),
      rollback: vi.fn().mockResolvedValue({
        rolledBackOperations: [],
        failedRollbacks: [],
        checkpoints: new Map(),
      }),
      clear: vi.fn(),
    } as any

    // Create mock RsyncHelper
    mockRsyncHelper = {
      isInstalled: vi.fn().mockResolvedValue(true),
      rsync: vi.fn().mockResolvedValue({
        success: true,
        filesTransferred: 100,
        bytesSent: 1024000,
        totalSize: 2048000,
        duration: 500,
      } as RsyncResult),
      buildCommand: vi.fn().mockReturnValue('rsync -av --delete source dest'),
      estimateFileCount: vi.fn().mockResolvedValue(100),
    } as any

    // Create mock SymlinkHelper
    mockSymlinkHelper = {
      createSymlinks: vi.fn().mockResolvedValue({
        success: true,
        created: 2,
        skipped: 0,
        conflicts: [],
      } as SymlinkResult),
      verifySymlink: vi.fn().mockResolvedValue(true),
      matchPatterns: vi.fn().mockResolvedValue(['package.json', 'pnpm-lock.yaml']),
      detectConflicts: vi.fn().mockResolvedValue([]),
      createSymlink: vi.fn().mockResolvedValue(undefined),
    } as any

    // Mock fs-extra default behavior
    vi.mocked(mockPathExists).mockResolvedValue(true)
    vi.mocked(mockStat).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
    } as any)
    vi.mocked(mockRemove).mockResolvedValue(undefined)

    // Mock factory functions
    const fileOps = await import('../../src/utils/fileOps')
    vi.mocked(fileOps.createRsyncHelper).mockReturnValue(mockRsyncHelper)
    vi.mocked(fileOps.createSymlinkHelper).mockReturnValue(mockSymlinkHelper)

    // Create orchestrator
    orchestrator = new WorktreeSetupOrchestrator(mockGitHelper, mockConfig)
    // Replace transaction with mock
    ;(orchestrator as any).transaction = mockTransaction
    ;(orchestrator as any).rsyncHelper = mockRsyncHelper
    ;(orchestrator as any).symlinkHelper = mockSymlinkHelper
  })

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Initialization', () => {
    it('should create orchestrator with config', () => {
      expect(orchestrator).toBeDefined()
      expect(orchestrator.getTransaction()).toBeDefined()
    })

    it('should validate source and worktree paths exist', async () => {
      vi.mocked(mockPathExists).mockResolvedValueOnce(true).mockResolvedValueOnce(true)

      await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockPathExists).toHaveBeenCalledWith('/repo/main')
      expect(mockPathExists).toHaveBeenCalledWith('/repo/feature')
    })

    it('should throw error if source path does not exist', async () => {
      vi.mocked(mockPathExists).mockResolvedValueOnce(false)

      await expect(orchestrator.setupNewWorktree('/repo/feature')).rejects.toThrow(
        'Source tree path does not exist'
      )
    })

    it('should throw error if worktree path does not exist', async () => {
      vi.mocked(mockPathExists).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

      await expect(orchestrator.setupNewWorktree('/repo/feature')).rejects.toThrow(
        'Worktree path does not exist'
      )
    })
  })

  // ==========================================================================
  // Phase 2: Checkpoint Tests
  // ==========================================================================

  describe('Phase 2: Checkpoint', () => {
    it('should create checkpoint before operations', async () => {
      await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockTransaction.createCheckpoint).toHaveBeenCalledWith('worktree', {
        path: '/repo/feature',
      })
    })
  })

  // ==========================================================================
  // Phase 3: Symlinks (Before Rsync) Tests
  // ==========================================================================

  describe('Phase 3: Symlinks (Before Rsync)', () => {
    it('should create symlinks before rsync when beforeRsync=true', async () => {
      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockSymlinkHelper.createSymlinks).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        mockConfig.symlink,
        {
          replaceExisting: true,
          skipConflicts: true,
        }
      )
      expect(result.symlinkResult).toBeDefined()
      expect(result.symlinkResult?.created).toBe(2)
    })

    it('should skip symlinks when skipSymlink=true', async () => {
      const options: SetupOptions = { skipSymlink: true }
      await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockSymlinkHelper.createSymlinks).not.toHaveBeenCalled()
    })

    it('should add warnings for symlink conflicts', async () => {
      mockSymlinkHelper.createSymlinks.mockResolvedValueOnce({
        success: true,
        created: 1,
        skipped: 2,
        conflicts: [
          { source: 'file1', target: 'dest1', reason: 'exists' },
          { source: 'file2', target: 'dest2', reason: 'exists' },
        ],
      } as SymlinkResult)

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(result.warnings).toContain('Skipped 2 symlink(s) due to conflicts')
    })

    it('should skip symlinks before rsync when beforeRsync=false', async () => {
      mockConfig.symlink.beforeRsync = false

      await orchestrator.setupNewWorktree('/repo/feature')

      // Should only be called once (after rsync)
      expect(mockSymlinkHelper.createSymlinks).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // Phase 4: Rsync Tests
  // ==========================================================================

  describe('Phase 4: Rsync', () => {
    it('should execute rsync with correct configuration', async () => {
      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockRsyncHelper.rsync).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        mockConfig.rsync,
        expect.objectContaining({
          excludePatterns: expect.arrayContaining(['.git', 'node_modules']),
        })
      )
      expect(result.rsyncResult).toBeDefined()
      expect(result.rsyncResult?.success).toBe(true)
    })

    it('should check rsync installation before executing', async () => {
      await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockRsyncHelper.isInstalled).toHaveBeenCalled()
    })

    it('should throw RsyncNotInstalledError when rsync not found', async () => {
      mockRsyncHelper.isInstalled.mockResolvedValueOnce(false)

      // Should throw SetupError that wraps RsyncNotInstalledError
      await expect(orchestrator.setupNewWorktree('/repo/feature')).rejects.toThrow(SetupError)

      try {
        await orchestrator.setupNewWorktree('/repo/feature')
      } catch (error) {
        expect(error).toBeInstanceOf(SetupError)
        expect((error as SetupError).cause).toBeInstanceOf(RsyncNotInstalledError)
      }
    })

    it('should skip rsync when skipRsync=true', async () => {
      const options: SetupOptions = { skipRsync: true }
      const result = await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockRsyncHelper.rsync).not.toHaveBeenCalled()
      expect(result.rsyncResult).toBeUndefined()
    })

    it('should skip rsync when config.rsync.enabled=false', async () => {
      mockConfig.rsync.enabled = false

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockRsyncHelper.rsync).not.toHaveBeenCalled()
      expect(result.rsyncResult).toBeUndefined()
    })

    it('should exclude symlinked files from rsync', async () => {
      // Mock operations to return symlink operations
      mockTransaction.getOperations.mockReturnValue([
        {
          type: 'create_symlink',
          path: '/repo/feature/package.json',
          metadata: { target: '/repo/main/package.json' },
          timestamp: new Date(),
        },
        {
          type: 'create_symlink',
          path: '/repo/feature/pnpm-lock.yaml',
          metadata: { target: '/repo/main/pnpm-lock.yaml' },
          timestamp: new Date(),
        },
      ])

      await orchestrator.setupNewWorktree('/repo/feature')

      // Implementation prepends '/' to symlink excludes for rsync root matching
      expect(mockRsyncHelper.rsync).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        mockConfig.rsync,
        expect.objectContaining({
          excludePatterns: expect.arrayContaining([
            '.git',
            'node_modules',
            '/package.json',
            '/pnpm-lock.yaml',
          ]),
        })
      )
    })

    it('should merge configuration with overrides', async () => {
      const options: SetupOptions = {
        rsyncOverride: {
          flags: ['-avz'],
          exclude: ['dist', 'build'],
        },
      }

      await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockRsyncHelper.rsync).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        expect.objectContaining({
          flags: ['-avz'],
          exclude: expect.arrayContaining(['node_modules', '.git', 'dist', 'build']),
        }),
        expect.any(Object)
      )
    })

    it('should call onProgress callback during rsync', async () => {
      const onProgress = vi.fn()
      const options: SetupOptions = { onProgress }

      await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(onProgress).toHaveBeenCalledWith(SetupPhase.RSYNC, 'Copying files with rsync')
    })
  })

  // ==========================================================================
  // Phase 5: Symlinks (After Rsync) Tests
  // ==========================================================================

  describe('Phase 5: Symlinks (After Rsync)', () => {
    beforeEach(() => {
      mockConfig.symlink.beforeRsync = false
    })

    it('should create symlinks after rsync when beforeRsync=false', async () => {
      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockSymlinkHelper.createSymlinks).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        mockConfig.symlink,
        {
          replaceExisting: true,
          skipConflicts: true,
        }
      )
      expect(result.symlinkResult).toBeDefined()
    })

    it('should replace files copied by rsync with symlinks', async () => {
      await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockSymlinkHelper.createSymlinks).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        mockConfig.symlink,
        expect.objectContaining({
          replaceExisting: true,
        })
      )
    })

    it('should add warnings for unresolved conflicts', async () => {
      mockSymlinkHelper.createSymlinks.mockResolvedValueOnce({
        success: true,
        created: 1,
        skipped: 0,
        conflicts: [{ source: 'file1', target: 'dest1', reason: 'permission denied' }],
      } as SymlinkResult)

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(result.warnings).toContain('Could not create 1 symlink(s) due to conflicts')
    })
  })

  // ==========================================================================
  // Phase 6: Validation Tests
  // ==========================================================================

  describe('Phase 6: Validation', () => {
    it('should validate worktree path still exists', async () => {
      await orchestrator.setupNewWorktree('/repo/feature')

      // Called multiple times: source check, worktree check, symlink file checks, validation check
      // Exact count depends on symlink patterns and beforeRsync setting
      expect(mockPathExists).toHaveBeenCalled()
      // Final validation call should be for worktree path
      expect(mockPathExists).toHaveBeenCalledWith('/repo/feature')
    })

    it('should add warning if worktree path disappeared', async () => {
      // Skip symlinks to simplify test - only need 3 pathExists calls
      const options: SetupOptions = { skipSymlink: true }

      // Exists during init, but not during validation
      mockPathExists
        .mockResolvedValueOnce(true) // source check
        .mockResolvedValueOnce(true) // worktree check
        .mockResolvedValueOnce(false) // validation check

      const result = await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(result.warnings).toContain('Worktree path no longer exists after setup')
    })

    it('should verify all created symlinks', async () => {
      mockTransaction.getOperations.mockReturnValue([
        {
          type: 'create_symlink',
          path: '/repo/feature/package.json',
          metadata: { target: '/repo/main/package.json' },
          timestamp: new Date(),
        },
        {
          type: 'create_symlink',
          path: '/repo/feature/pnpm-lock.yaml',
          metadata: { target: '/repo/main/pnpm-lock.yaml' },
          timestamp: new Date(),
        },
      ])

      await orchestrator.setupNewWorktree('/repo/feature')

      expect(mockSymlinkHelper.verifySymlink).toHaveBeenCalledWith(
        '/repo/feature/package.json',
        '/repo/main/package.json'
      )
      expect(mockSymlinkHelper.verifySymlink).toHaveBeenCalledWith(
        '/repo/feature/pnpm-lock.yaml',
        '/repo/main/pnpm-lock.yaml'
      )
    })

    it('should add warning for failed symlink verification', async () => {
      mockTransaction.getOperations.mockReturnValue([
        {
          type: 'create_symlink',
          path: '/repo/feature/package.json',
          metadata: { target: '/repo/main/package.json' },
          timestamp: new Date(),
        },
      ])
      mockSymlinkHelper.verifySymlink.mockResolvedValueOnce(false)

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(result.warnings).toContain('Symlink verification failed: /repo/feature/package.json')
    })

    it('should add warning if rsync was unsuccessful', async () => {
      mockRsyncHelper.rsync.mockResolvedValueOnce({
        success: false,
        filesTransferred: 50,
        bytesSent: 512000,
        totalSize: 1024000,
        duration: 300,
      } as RsyncResult)

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(result.warnings).toContain('Rsync reported unsuccessful completion')
    })
  })

  // ==========================================================================
  // Phase 7: Completion Tests
  // ==========================================================================

  describe('Phase 7: Completion', () => {
    it('should return successful result with all data', async () => {
      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(result.success).toBe(true)
      expect(result.rsyncResult).toBeDefined()
      expect(result.symlinkResult).toBeDefined()
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.warnings).toEqual([])
      expect(result.rolledBack).toBe(false)
    })

    it('should track setup duration', async () => {
      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(typeof result.duration).toBe('number')
    })

    it('should call onProgress with COMPLETE phase', async () => {
      const onProgress = vi.fn()

      await orchestrator.setupNewWorktree('/repo/feature', { onProgress })

      expect(onProgress).toHaveBeenCalledWith(SetupPhase.COMPLETE, 'Setup complete')
    })
  })

  // ==========================================================================
  // Error Handling & Rollback Tests
  // ==========================================================================

  describe('Error Handling & Rollback', () => {
    it('should rollback on rsync error', async () => {
      mockRsyncHelper.rsync.mockRejectedValueOnce(new Error('Rsync failed'))

      await expect(orchestrator.setupNewWorktree('/repo/feature')).rejects.toThrow(SetupError)

      expect(mockTransaction.rollback).toHaveBeenCalled()
    })

    it('should rollback on symlink error', async () => {
      mockSymlinkHelper.createSymlinks.mockRejectedValueOnce(new Error('Symlink failed'))

      await expect(orchestrator.setupNewWorktree('/repo/feature')).rejects.toThrow(SetupError)

      expect(mockTransaction.rollback).toHaveBeenCalled()
    })

    it('should call onProgress with ROLLBACK phase on error', async () => {
      const onProgress = vi.fn()
      mockRsyncHelper.rsync.mockRejectedValueOnce(new Error('Rsync failed'))

      try {
        await orchestrator.setupNewWorktree('/repo/feature', { onProgress })
      } catch {
        // Expected
      }

      expect(onProgress).toHaveBeenCalledWith(SetupPhase.ROLLBACK, 'Error occurred, rolling back')
    })

    it('should include rollback status in error result', async () => {
      mockRsyncHelper.rsync.mockRejectedValueOnce(new Error('Rsync failed'))

      try {
        await orchestrator.setupNewWorktree('/repo/feature')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).toBeInstanceOf(SetupError)
        const setupError = error as SetupError
        expect(setupError.result.rolledBack).toBe(true)
        expect(setupError.result.success).toBe(false)
      }
    })

    it('should add warning if rollback partially fails', async () => {
      mockRsyncHelper.rsync.mockRejectedValueOnce(new Error('Rsync failed'))
      mockTransaction.rollback.mockRejectedValueOnce(new Error('Rollback failed'))

      try {
        await orchestrator.setupNewWorktree('/repo/feature')
        expect.fail('Should have thrown error')
      } catch (error) {
        const setupError = error as SetupError
        expect(setupError.result.warnings).toEqual([expect.stringContaining('Rollback failed')])
        expect(setupError.result.rolledBack).toBe(false)
      }
    })

    it('should include partial results in error', async () => {
      // Symlinks succeed, then rsync fails
      mockSymlinkHelper.createSymlinks.mockResolvedValueOnce({
        success: true,
        created: 2,
        skipped: 0,
        conflicts: [],
      } as SymlinkResult)
      mockRsyncHelper.rsync.mockRejectedValueOnce(new Error('Rsync failed'))

      try {
        await orchestrator.setupNewWorktree('/repo/feature')
        expect.fail('Should have thrown error')
      } catch (error) {
        const setupError = error as SetupError
        expect(setupError.result.symlinkResult).toBeDefined()
        expect(setupError.result.symlinkResult?.created).toBe(2)
        expect(setupError.result.rsyncResult).toBeUndefined()
      }
    })

    it('should preserve original error as cause', async () => {
      const originalError = new Error('Original error')
      mockRsyncHelper.rsync.mockRejectedValueOnce(originalError)

      try {
        await orchestrator.setupNewWorktree('/repo/feature')
        expect.fail('Should have thrown error')
      } catch (error) {
        const setupError = error as SetupError
        expect(setupError.cause).toBe(originalError)
      }
    })

    it('should remove worktree using checkpoint from rollback result (regression test)', async () => {
      // This test verifies the fix for the bug where worktree was not deleted on error
      // because rollback() cleared checkpoints before we could retrieve them
      mockRsyncHelper.rsync.mockRejectedValueOnce(new Error('Rsync failed'))

      // Mock rollback to return preserved checkpoints (simulating the fix)
      mockTransaction.rollback.mockResolvedValueOnce({
        rolledBackOperations: [],
        failedRollbacks: [],
        checkpoints: new Map([['worktree', { path: '/repo/feature' }]]),
      })

      try {
        await orchestrator.setupNewWorktree('/repo/feature')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).toBeInstanceOf(SetupError)
        // CRITICAL: Verify worktree removal was called with the checkpoint path
        expect(mockGitHelper.removeWorktree).toHaveBeenCalledWith('/repo/feature', true)
      }
    })

    it('should handle missing checkpoint gracefully during rollback', async () => {
      mockRsyncHelper.rsync.mockRejectedValueOnce(new Error('Rsync failed'))

      // Mock rollback to return empty checkpoints (edge case)
      mockTransaction.rollback.mockResolvedValueOnce({
        rolledBackOperations: [],
        failedRollbacks: [],
        checkpoints: new Map(), // No worktree checkpoint
      })

      try {
        await orchestrator.setupNewWorktree('/repo/feature')
        expect.fail('Should have thrown error')
      } catch (error) {
        // Should not crash, just skip worktree removal
        expect(error).toBeInstanceOf(SetupError)
        expect(mockGitHelper.removeWorktree).not.toHaveBeenCalled()
      }
    })
  })

  // ==========================================================================
  // Progress Tracking Tests
  // ==========================================================================

  describe('Progress Tracking', () => {
    it('should call onProgress for all phases', async () => {
      const onProgress = vi.fn()

      await orchestrator.setupNewWorktree('/repo/feature', { onProgress })

      expect(onProgress).toHaveBeenCalledWith(SetupPhase.INIT, 'Initializing setup')
      expect(onProgress).toHaveBeenCalledWith(SetupPhase.CHECKPOINT, 'Creating checkpoint')
      expect(onProgress).toHaveBeenCalledWith(
        SetupPhase.SYMLINK_BEFORE,
        'Creating symlinks (before rsync)'
      )
      expect(onProgress).toHaveBeenCalledWith(SetupPhase.RSYNC, 'Copying files with rsync')
      expect(onProgress).toHaveBeenCalledWith(SetupPhase.VALIDATION, 'Validating setup')
      expect(onProgress).toHaveBeenCalledWith(SetupPhase.COMPLETE, 'Setup complete')
    })

    it('should not call onProgress when callback not provided', async () => {
      // Should not throw
      await orchestrator.setupNewWorktree('/repo/feature')
    })
  })

  // ==========================================================================
  // Configuration Override Tests
  // ==========================================================================

  describe('Configuration Overrides', () => {
    it('should merge rsync configuration', async () => {
      const options: SetupOptions = {
        rsyncOverride: {
          flags: ['-avz', '--progress'],
          exclude: ['dist'],
        },
      }

      await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockRsyncHelper.rsync).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        expect.objectContaining({
          flags: ['-avz', '--progress'],
          exclude: expect.arrayContaining(['node_modules', '.git', 'dist']),
        }),
        expect.any(Object)
      )
    })

    it('should merge symlink configuration', async () => {
      const options: SetupOptions = {
        symlinkOverride: {
          patterns: ['tsconfig.json', '*.config.js'],
        },
      }

      await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockSymlinkHelper.createSymlinks).toHaveBeenCalledWith(
        '/repo/main',
        '/repo/feature',
        expect.objectContaining({
          patterns: expect.arrayContaining([
            'package.json',
            'pnpm-lock.yaml',
            'tsconfig.json',
            '*.config.js',
          ]),
        }),
        expect.any(Object)
      )
    })

    it('should respect skipRsync and skipSymlink flags', async () => {
      const options: SetupOptions = {
        skipRsync: true,
        skipSymlink: true,
      }

      const result = await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockRsyncHelper.rsync).not.toHaveBeenCalled()
      expect(mockSymlinkHelper.createSymlinks).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Scenarios', () => {
    it('should handle full workflow with symlinks before rsync', async () => {
      mockConfig.symlink.beforeRsync = true

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      // Verify order of operations
      const callOrder = [
        mockTransaction.createCheckpoint,
        mockSymlinkHelper.createSymlinks,
        mockRsyncHelper.rsync,
      ]

      for (let i = 0; i < callOrder.length - 1; i++) {
        expect(callOrder[i].mock.invocationCallOrder[0]).toBeLessThan(
          callOrder[i + 1].mock.invocationCallOrder[0]
        )
      }

      expect(result.success).toBe(true)
      expect(result.symlinkResult?.created).toBeGreaterThan(0)
      expect(result.rsyncResult?.filesTransferred).toBeGreaterThan(0)
    })

    it('should handle full workflow with symlinks after rsync', async () => {
      mockConfig.symlink.beforeRsync = false

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      // Verify order of operations
      const callOrder = [
        mockTransaction.createCheckpoint,
        mockRsyncHelper.rsync,
        mockSymlinkHelper.createSymlinks,
      ]

      for (let i = 0; i < callOrder.length - 1; i++) {
        expect(callOrder[i].mock.invocationCallOrder[0]).toBeLessThan(
          callOrder[i + 1].mock.invocationCallOrder[0]
        )
      }

      expect(result.success).toBe(true)
    })

    it('should handle rsync-only workflow', async () => {
      const options: SetupOptions = { skipSymlink: true }

      const result = await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockSymlinkHelper.createSymlinks).not.toHaveBeenCalled()
      expect(mockRsyncHelper.rsync).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.symlinkResult).toBeUndefined()
    })

    it('should handle symlink-only workflow', async () => {
      const options: SetupOptions = { skipRsync: true }

      const result = await orchestrator.setupNewWorktree('/repo/feature', options)

      expect(mockRsyncHelper.rsync).not.toHaveBeenCalled()
      expect(mockSymlinkHelper.createSymlinks).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.rsyncResult).toBeUndefined()
    })

    it('should handle workflow with warnings but still succeed', async () => {
      mockSymlinkHelper.createSymlinks.mockResolvedValueOnce({
        success: true,
        created: 1,
        skipped: 1,
        conflicts: [{ source: 'file1', target: 'dest1', reason: 'exists' }],
      } as SymlinkResult)

      const result = await orchestrator.setupNewWorktree('/repo/feature')

      expect(result.success).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Transaction Access Tests
  // ==========================================================================

  describe('Transaction Access', () => {
    it('should provide access to transaction', () => {
      const transaction = orchestrator.getTransaction()

      expect(transaction).toBeDefined()
      expect(transaction).toBe(mockTransaction)
    })
  })
})
