export interface GitRetryOptions {
  maxAttempts?: number
  baseMs?: number
  capMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_BASE_MS = 100
const DEFAULT_CAP_MS = 2000

const EXIT_CODE_PATTERN =
  /\bexit(?:ed)?\s+(?:with\s+)?(?:(?:code|status)\s+)?128\b(?=[^\w\s]|\s*(?:[\r\n]|$))/i
const LOCK_PATTERN = /\.lock\b|unable to create|cannot lock/i
const PERMANENT_FAILURE_PATTERN =
  /permission denied|operation not permitted|read-only file system|access denied|authorization|publickey|authentication|could not read username|not enough space|no space left on device|disk quota exceeded/i

type GitError = Error & {
  code?: unknown
  exitCode?: unknown
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isTransientLockError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const gitError = error as GitError
  const permanentCode =
    typeof gitError.code === 'string' && /^(EACCES|EPERM|ENOSPC|EDQUOT)$/i.test(gitError.code)
  // Git wrappers expose status via properties or only embed it in the message.
  const hasExitCode128 =
    gitError.exitCode === 128 || gitError.code === 128 || EXIT_CODE_PATTERN.test(error.message)

  return (
    hasExitCode128 &&
    LOCK_PATTERN.test(error.message) &&
    !PERMANENT_FAILURE_PATTERN.test(error.message) &&
    !permanentCode
  )
}

export async function withGitRetry<T>(
  fn: () => Promise<T>,
  opts: GitRetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS
  const capMs = opts.capMs ?? DEFAULT_CAP_MS

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn()
    } catch (error: unknown) {
      if (!isTransientLockError(error) || attempt >= maxAttempts) {
        throw error
      }

      // Full jitter mitigates thundering-herd contention on the same lock.
      const backoffLimit = Math.min(capMs, baseMs * 2 ** Math.min(attempt - 1, 30))
      await delay(Math.random() * backoffLimit)
    }
  }
}
