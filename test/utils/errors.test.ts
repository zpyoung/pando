import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorHelper } from '../../src/utils/errors.js'
import type { Command } from '@oclif/core'

describe('ErrorHelper', () => {
  let mockCommand: Command
  let mockLog: ReturnType<typeof vi.fn>
  let mockError: ReturnType<typeof vi.fn>
  let mockWarn: ReturnType<typeof vi.fn>
  let mockExit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockLog = vi.fn()
    mockError = vi.fn()
    mockWarn = vi.fn()
    mockExit = vi.fn()

    mockCommand = {
      log: mockLog,
      error: mockError,
      warn: mockWarn,
      exit: mockExit,
    } as unknown as Command
  })

  describe('validation()', () => {
    it('should output clean error message without JSON flag', () => {
      try {
        ErrorHelper.validation(mockCommand, 'Test validation error', false)
      } catch {
        // Expected to exit
      }

      expect(mockError).toHaveBeenCalledWith('Test validation error', { exit: false })
      expect(mockExit).toHaveBeenCalledWith(1)
      expect(mockLog).not.toHaveBeenCalled()
    })

    it('should output JSON format when json flag is true', () => {
      try {
        ErrorHelper.validation(mockCommand, 'Test validation error', true)
      } catch {
        // Expected to exit
      }

      expect(mockLog).toHaveBeenCalledWith(
        JSON.stringify(
          {
            status: 'error',
            error: 'Test validation error',
          },
          null,
          2
        )
      )
      expect(mockExit).toHaveBeenCalledWith(1)
      expect(mockError).not.toHaveBeenCalled()
    })

    it('should handle multiline error messages', () => {
      const multilineMessage = 'Error occurred\nUse --force to override'

      try {
        ErrorHelper.validation(mockCommand, multilineMessage, false)
      } catch {
        // Expected to exit
      }

      expect(mockError).toHaveBeenCalledWith(multilineMessage, { exit: false })
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should default to non-JSON mode when flag is undefined', () => {
      try {
        ErrorHelper.validation(mockCommand, 'Test error', undefined)
      } catch {
        // Expected to exit
      }

      expect(mockError).toHaveBeenCalledWith('Test error', { exit: false })
      expect(mockExit).toHaveBeenCalledWith(1)
      expect(mockLog).not.toHaveBeenCalled()
    })
  })

  describe('operation()', () => {
    it('should output error with context in non-JSON mode', () => {
      const error = new Error('Operation failed')

      try {
        ErrorHelper.operation(mockCommand, error, 'Failed to create worktree', false)
      } catch {
        // Expected to exit
      }

      expect(mockError).toHaveBeenCalledWith('Failed to create worktree: Operation failed', {
        exit: false,
      })
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should output detailed JSON in JSON mode', () => {
      const error = new Error('Network timeout')

      try {
        ErrorHelper.operation(mockCommand, error, 'Failed to sync', true)
      } catch {
        // Expected to exit
      }

      expect(mockLog).toHaveBeenCalledWith(
        JSON.stringify(
          {
            status: 'error',
            error: 'Failed to sync: Network timeout',
            context: 'Failed to sync',
            details: 'Network timeout',
          },
          null,
          2
        )
      )
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should handle errors with complex messages', () => {
      const error = new Error('ENOENT: no such file or directory, open "/path/to/file"')

      try {
        ErrorHelper.operation(mockCommand, error, 'File operation failed', false)
      } catch {
        // Expected to exit
      }

      expect(mockError).toHaveBeenCalledWith(
        'File operation failed: ENOENT: no such file or directory, open "/path/to/file"',
        { exit: false }
      )
    })
  })

  describe('unexpected()', () => {
    it('should call command.error with full stack trace', () => {
      const error = new Error('Critical internal error')

      try {
        ErrorHelper.unexpected(mockCommand, error)
      } catch {
        // May or may not throw depending on oclif behavior
      }

      // unexpected() calls command.error without { exit: false }, showing stack trace
      expect(mockError).toHaveBeenCalledWith('Critical internal error')
    })

    it('should handle errors with stack traces', () => {
      const error = new Error('State corruption detected')
      error.stack =
        'Error: State corruption detected\n    at Object.<anonymous> (/path/to/file.ts:10:15)'

      try {
        ErrorHelper.unexpected(mockCommand, error)
      } catch {
        // May or may not throw
      }

      expect(mockError).toHaveBeenCalledWith('State corruption detected')
    })
  })

  describe('warn()', () => {
    it('should output warning message in non-JSON mode', () => {
      ErrorHelper.warn(mockCommand, 'This feature is deprecated', false)

      expect(mockWarn).toHaveBeenCalledWith('This feature is deprecated')
      expect(mockLog).not.toHaveBeenCalled()
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('should output warning in JSON format when json flag is true', () => {
      ErrorHelper.warn(mockCommand, 'Configuration will be ignored', true)

      expect(mockLog).toHaveBeenCalledWith(
        JSON.stringify(
          {
            status: 'warning',
            warning: 'Configuration will be ignored',
          },
          null,
          2
        )
      )
      expect(mockWarn).not.toHaveBeenCalled()
    })

    it('should not exit the process', () => {
      ErrorHelper.warn(mockCommand, 'Non-fatal warning', false)

      expect(mockExit).not.toHaveBeenCalled()
    })

    it('should default to non-JSON mode when flag is undefined', () => {
      ErrorHelper.warn(mockCommand, 'Default warning', undefined)

      expect(mockWarn).toHaveBeenCalledWith('Default warning')
      expect(mockLog).not.toHaveBeenCalled()
    })
  })

  describe('Error type classification', () => {
    it('validation() should be used for expected user errors', () => {
      // Examples: file exists, invalid input, missing requirements
      try {
        ErrorHelper.validation(mockCommand, 'File already exists. Use --force to overwrite.', false)
      } catch {
        // Expected
      }

      expect(mockError).toHaveBeenCalledWith('File already exists. Use --force to overwrite.', {
        exit: false,
      })
    })

    it('operation() should be used for runtime failures', () => {
      // Examples: network errors, permission errors, external command failures
      const error = new Error('EACCES: permission denied')

      try {
        ErrorHelper.operation(mockCommand, error, 'Failed to write config', false)
      } catch {
        // Expected
      }

      expect(mockError).toHaveBeenCalledWith('Failed to write config: EACCES: permission denied', {
        exit: false,
      })
    })

    it('unexpected() should be used for internal errors', () => {
      // Examples: null pointer, missing initialization, invalid state
      const error = new Error('Chalk not initialized - this should never happen')

      try {
        ErrorHelper.unexpected(mockCommand, error)
      } catch {
        // Expected
      }

      expect(mockError).toHaveBeenCalledWith('Chalk not initialized - this should never happen')
    })
  })

  describe('JSON output consistency', () => {
    it('all error methods should produce valid JSON', () => {
      // validation
      try {
        ErrorHelper.validation(mockCommand, 'Test', true)
      } catch {
        // Expected
      }
      const validationOutput = mockLog.mock.calls[0][0]
      expect(() => JSON.parse(validationOutput)).not.toThrow()

      mockLog.mockClear()

      // operation
      try {
        ErrorHelper.operation(mockCommand, new Error('Test'), 'Context', true)
      } catch {
        // Expected
      }
      const operationOutput = mockLog.mock.calls[0][0]
      expect(() => JSON.parse(operationOutput)).not.toThrow()

      mockLog.mockClear()

      // warn
      ErrorHelper.warn(mockCommand, 'Test', true)
      const warnOutput = mockLog.mock.calls[0][0]
      expect(() => JSON.parse(warnOutput)).not.toThrow()
    })

    it('JSON output should have consistent structure', () => {
      // validation
      try {
        ErrorHelper.validation(mockCommand, 'Test', true)
      } catch {
        // Expected
      }
      const validation = JSON.parse(mockLog.mock.calls[0][0])
      expect(validation).toHaveProperty('status')
      expect(validation).toHaveProperty('error')

      mockLog.mockClear()

      // operation
      try {
        ErrorHelper.operation(mockCommand, new Error('Test'), 'Context', true)
      } catch {
        // Expected
      }
      const operation = JSON.parse(mockLog.mock.calls[0][0])
      expect(operation).toHaveProperty('status')
      expect(operation).toHaveProperty('error')
      expect(operation).toHaveProperty('context')
      expect(operation).toHaveProperty('details')

      mockLog.mockClear()

      // warn
      ErrorHelper.warn(mockCommand, 'Test', true)
      const warn = JSON.parse(mockLog.mock.calls[0][0])
      expect(warn).toHaveProperty('status')
      expect(warn).toHaveProperty('warning')
    })
  })
})
