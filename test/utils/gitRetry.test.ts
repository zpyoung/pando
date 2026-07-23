import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTransientLockError, withGitRetry } from '../../src/utils/gitRetry'

const REAL_SIMPLE_GIT_LOCK_MESSAGE =
  "fatal: cannot lock ref 'refs/heads/feat': Unable to create '/.../feat.lock': File exists.\n\nAnother git process seems to be running ..."

function lockError(message = "fatal: Unable to create '.git/index.lock': File exists."): Error {
  return Object.assign(new Error(message), { exitCode: 128 })
}

function realSimpleGitLockError(): Error {
  return Object.assign(new Error(REAL_SIMPLE_GIT_LOCK_MESSAGE), { task: {} })
}

describe('isTransientLockError', () => {
  it.each([
    Object.assign(new Error("fatal: Unable to create '.git/index.lock': File exists."), {
      exitCode: 128,
    }),
    Object.assign(new Error("fatal: cannot lock ref 'refs/heads/main'"), { code: 128 }),
    new Error('Git exited with 128: packed-refs.lock already exists'),
    new Error("fatal: cannot lock ref 'refs/heads/main'\nProcess exited with code 128"),
  ])('classifies exit 128 lock contention as transient', (error) => {
    expect(isTransientLockError(error)).toBe(true)
  })

  it.each([
    'Permission denied',
    'authentication failed',
    'could not read Username for remote',
    'No space left on device',
    'Disk quota exceeded',
  ])('rejects lock errors caused by permanent failures: %s', (reason) => {
    expect(isTransientLockError(lockError(`cannot lock ref: ${reason}`))).toBe(false)
  })

  it.each([
    Object.assign(new Error("fatal: Unable to create '.git/index.lock': Operation not permitted"), {
      exitCode: 128,
    }),
    Object.assign(lockError(), { code: 'EACCES' }),
  ])('rejects permanent lock failures', (error) => {
    expect(isTransientLockError(error)).toBe(false)
  })

  it('distinguishes a ref D/F conflict from real lock-file contention without an exit code', () => {
    const refConflict = new Error(
      "cannot lock ref 'refs/heads/foo/bar': 'refs/heads/foo' exists; cannot create 'refs/heads/foo/bar'"
    )
    const lockContention = new Error(
      "cannot lock ref 'refs/heads/foo': Unable to create '/repo/.git/refs/heads/foo.lock': File exists"
    )

    expect(isTransientLockError(refConflict)).toBe(false)
    expect(isTransientLockError(lockContention)).toBe(true)
  })

  it('does not retry a ref D/F conflict even when it carries exit code 128', () => {
    const refConflict = Object.assign(
      new Error(
        "cannot lock ref 'refs/heads/foo/bar': 'refs/heads/foo' exists; cannot create 'refs/heads/foo/bar'"
      ),
      { exitCode: 128 }
    )

    expect(isTransientLockError(refConflict)).toBe(false)
  })

  it('rejects a non-definitive lock mention without exit code 128', () => {
    const error = Object.assign(new Error('fatal: index.lock already exists'), { exitCode: 1 })

    expect(isTransientLockError(error)).toBe(false)
  })

  it('rejects a bare unable-to-create message even with exit code 128', () => {
    const error = Object.assign(new Error('fatal: unable to create temporary output'), {
      exitCode: 128,
    })

    expect(isTransientLockError(error)).toBe(false)
  })

  it('does not treat a numeric count as an exit code', () => {
    const error = new Error('migration exited with 128 commits remaining; stale index.lock found')

    expect(isTransientLockError(error)).toBe(false)
  })

  it.each([
    'fatal: exit code 128: index.lock already exists',
    undefined,
    { exitCode: 128, message: 'fatal: index.lock already exists' },
  ])('returns false for non-Error input without throwing', (value) => {
    expect(isTransientLockError(value)).toBe(false)
  })
})

describe('withGitRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('retries a transient lock error and returns the successful result', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const operation = vi.fn().mockRejectedValueOnce(lockError()).mockResolvedValueOnce('success')

    const result = withGitRetry(operation, { baseMs: 100 })
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('success')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('recognizes and retries the real simple-git lock error without an exit code', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const error = realSimpleGitLockError()
    const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success')

    expect('exitCode' in error).toBe(false)
    expect(isTransientLockError(error)).toBe(true)

    const result = withGitRetry(operation)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('success')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('does not retry a permanent permission failure', async () => {
    const error = lockError("fatal: Unable to create '.git/index.lock': Permission denied")
    const operation = vi.fn().mockRejectedValue(error)

    await expect(withGitRetry(operation)).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('throws the last error after exactly maxAttempts attempts', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const errors = [
      lockError('cannot lock ref: first'),
      lockError('cannot lock ref: second'),
      lockError('cannot lock ref: third'),
    ]
    const operation = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2])

    const result = withGitRetry(operation, { maxAttempts: 3 })
    const rejection = expect(result).rejects.toBe(errors[2])
    await vi.runAllTimersAsync()

    await rejection
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('applies full jitter within the capped exponential backoff bounds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    const operation = vi
      .fn()
      .mockRejectedValueOnce(lockError())
      .mockRejectedValueOnce(lockError())
      .mockRejectedValueOnce(lockError())
      .mockRejectedValueOnce(lockError())
      .mockResolvedValueOnce('success')

    const result = withGitRetry(operation, { maxAttempts: 5, baseMs: 100, capMs: 250 })
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('success')

    const bounds = [100, 200, 250, 250]
    const delays = timerSpy.mock.calls.map(([, ms]) => ms)
    expect(delays).toEqual(bounds.map((bound) => bound * 0.5))
    delays.forEach((delay, index) => {
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(bounds[index])
    })
  })

  it('keeps the delay finite at high attempt indexes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    let attempts = 0
    const operation = vi.fn().mockImplementation(async () => {
      attempts += 1
      if (attempts <= 1025) {
        throw lockError()
      }
      return 'success'
    })

    const result = withGitRetry(operation, {
      maxAttempts: 1026,
      baseMs: 1,
      capMs: Number.POSITIVE_INFINITY,
    })
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('success')

    const delays = timerSpy.mock.calls.map(([, ms]) => ms)
    expect(delays).toHaveLength(1025)
    expect(delays.every((ms) => Number.isFinite(ms))).toBe(true)
  })
})
