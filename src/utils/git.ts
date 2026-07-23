import { stat, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { withGitRetry, type GitRetryOptions } from './gitRetry.js'
import { readMetadata, type WorktreeMetadata } from './worktreeMetadata.js'

/**
 * Canonicalize a path for worktree comparison: make it absolute (relative to
 * cwd) and resolve symlinks via realpath. On macOS `/tmp` -> `/private/tmp` and
 * `process.cwd()` can disagree with the absolute path git records, so a raw
 * string compare would spuriously miss. Falls back to a plain resolve when the
 * path does not exist on disk.
 */
async function canonicalizePath(target: string): Promise<string> {
  const absolute = isAbsolute(target) ? target : resolve(process.cwd(), target)
  try {
    return await realpath(absolute)
  } catch {
    return resolve(absolute)
  }
}

/**
 * Git utility wrapper for worktree and branch operations
 *
 * Provides a clean abstraction over simple-git for common
 * pando operations with proper error handling and type safety.
 */

export interface WorktreeInfo {
  path: string
  branch: string | null
  commit: string
  isPrunable: boolean
  isExistingBranch?: boolean
  isLocked?: boolean
}

export interface BranchInfo {
  name: string
  current: boolean
  commit: string
  label: string
}

/**
 * Information about a backup branch created by `pando branch backup`
 */
export interface BackupBranchInfo {
  /** Full backup branch name (e.g., backup/feature/20250117-153045) */
  name: string
  /** The source branch this backup was created from */
  sourceBranch: string
  /** Commit SHA the backup points to */
  commit: string
  /** UTC timestamp string (ISO format) */
  timestamp: string
  /** Optional user-provided message stored in branch description */
  message?: string
}

/**
 * Represents a commit entry from git log
 */
export interface CommitLogEntry {
  /** Short commit hash (7 characters) */
  hash: string
  /** First line of commit message */
  message: string
}

/**
 * Stale worktree information with detection reason
 */
export interface StaleWorktreeInfo extends WorktreeInfo {
  staleReason: 'merged' | 'gone' | 'prunable' | null
  hasUncommittedChanges: boolean
  trackingBranch?: string
}

export class GitHelper {
  private git: SimpleGit
  private retryConfig: GitRetryOptions | undefined

  constructor(baseDir?: string, retryConfig?: GitRetryOptions) {
    this.git = simpleGit(baseDir)
    this.retryConfig = retryConfig
  }

  setRetryConfig(cfg?: GitRetryOptions): void {
    this.retryConfig = cfg
  }

  /**
   * Check if the current directory is a git repository
   */
  async isRepository(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir'])
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the root directory of the git repository
   */
  async getRepositoryRoot(): Promise<string> {
    try {
      const root = await this.git.revparse(['--show-toplevel'])
      return root.trim()
    } catch {
      throw new Error('Not a git repository or unable to determine root')
    }
  }

  /**
   * Get the main worktree path (source for rsync operations)
   */
  async getMainWorktreePath(): Promise<string> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain'])
    const lines = output.split('\n')

    // Main worktree is always the first entry in the output
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        return line.substring('worktree '.length).trim()
      }
    }

    throw new Error('Unable to determine main worktree path')
  }

  /**
   * Resolve the HEAD commit for a specific worktree path.
   */
  async getWorktreeCommit(worktreePath: string): Promise<string> {
    const gitInWorktree = simpleGit(worktreePath)
    const commit = await gitInWorktree.revparse(['HEAD'])
    return commit.trim()
  }

  /**
   * Add a new worktree
   * Supports creating new branches (-b), checking out existing branches,
   * and force-resetting branches (-B)
   */
  async addWorktree(
    path: string,
    options?: {
      branch?: string
      commit?: string
      force?: boolean
      skipPostCreate?: boolean
    }
  ): Promise<WorktreeInfo> {
    const args = ['worktree', 'add']

    // Determine if branch exists when branch is specified
    const branchExists = options?.branch ? await this.branchExists(options.branch) : false

    // Add branch option with appropriate flag
    if (options?.branch) {
      if (options?.force) {
        // -B flag: Force create/reset branch
        args.push('-B', options.branch)
      } else if (!branchExists) {
        // -b flag: Create new branch
        args.push('-b', options.branch)
      }
      // If branch exists and no force: no flag needed, git will checkout existing branch
    }

    // Add path
    args.push(path)

    // Add commit/branch reference if specified
    if (options?.commit) {
      args.push(options.commit)
    } else if (options?.branch && branchExists && !options?.force) {
      // When checking out existing branch without commit, explicitly pass branch name
      args.push(options.branch)
    }

    // Execute worktree add command
    await withGitRetry(() => this.git.raw(args), this.retryConfig)

    // Get the commit hash for the new worktree, not the source checkout.
    const commitHash = await this.getWorktreeCommit(path)

    // Determine if this was an existing branch checkout (not new creation or force reset)
    const isExistingBranch = branchExists && !options?.force

    return {
      path,
      branch: options?.branch || null,
      commit: commitHash,
      isPrunable: false,
      isExistingBranch,
    }
  }

  /**
   * List all worktrees
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain'])
    const lines = output.split('\n')
    const worktrees: WorktreeInfo[] = []

    let currentWorktree: Partial<WorktreeInfo> = {}

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentWorktree.path = line.substring('worktree '.length).trim()
      } else if (line.startsWith('HEAD ')) {
        currentWorktree.commit = line.substring('HEAD '.length).trim()
      } else if (line.startsWith('branch ')) {
        const branchRef = line.substring('branch '.length).trim()
        // Extract branch name from refs/heads/...
        currentWorktree.branch = branchRef.replace('refs/heads/', '')
      } else if (line.startsWith('detached')) {
        currentWorktree.branch = null
      } else if (line.startsWith('prunable')) {
        currentWorktree.isPrunable = true
      } else if (line === 'locked' || line.startsWith('locked ')) {
        currentWorktree.isLocked = true
      } else if (line === '' && currentWorktree.path) {
        // Empty line marks end of worktree entry
        worktrees.push({
          path: currentWorktree.path,
          branch: currentWorktree.branch || null,
          commit: currentWorktree.commit || '',
          isPrunable: currentWorktree.isPrunable || false,
          ...(currentWorktree.isLocked ? { isLocked: true } : {}),
        })
        currentWorktree = {}
      }
    }

    // Handle last entry if no trailing newline
    if (currentWorktree.path) {
      worktrees.push({
        path: currentWorktree.path,
        branch: currentWorktree.branch || null,
        commit: currentWorktree.commit || '',
        isPrunable: currentWorktree.isPrunable || false,
        ...(currentWorktree.isLocked ? { isLocked: true } : {}),
      })
    }

    return worktrees
  }

  /**
   * Find the linked worktree whose path matches `targetPath`.
   *
   * Paths are compared after canonicalization (realpath) so a symlinked target
   * or a cwd-relative path still matches the absolute path git records. `isMain`
   * is true for the main worktree, which git's porcelain output always lists
   * first.
   *
   * @param targetPath - Absolute or cwd-relative path to look up
   * @returns The matching worktree plus whether it is the main worktree, or null
   *   when no linked worktree matches
   */
  async getWorktreeByPath(
    targetPath: string
  ): Promise<{ info: WorktreeInfo; isMain: boolean } | null> {
    const worktrees = await this.listWorktrees()
    const resolvedTarget = await canonicalizePath(targetPath)

    for (const [index, info] of worktrees.entries()) {
      const resolvedInfo = await canonicalizePath(info.path)
      if (resolvedInfo === resolvedTarget) {
        return { info, isMain: index === 0 }
      }
    }

    return null
  }

  /**
   * Check if a worktree has uncommitted changes
   */
  async hasUncommittedChanges(path: string): Promise<boolean> {
    try {
      const gitInWorktree = simpleGit(path)
      const status = await gitInWorktree.status()
      return !status.isClean()
    } catch {
      // If we can't check status, assume it's safe to proceed
      return false
    }
  }

  /**
   * Count the number of modified files in a worktree's working tree
   *
   * Counts files that have staged or unstaged modifications (M, MM, AM,
   * RM, CM in either the index or working-dir position).
   *
   * @param worktreePath - Path to the worktree
   * @returns Number of modified files
   */
  async getUncommittedFileCount(worktreePath: string): Promise<number> {
    const gitInWorktree = simpleGit(worktreePath)
    const status = await gitInWorktree.status()
    const modifiedStates = ['M', 'MM', 'AM', 'RM', 'CM']
    return status.files.filter(
      (f) => modifiedStates.includes(f.index) || modifiedStates.includes(f.working_dir)
    ).length
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(path: string, force?: boolean): Promise<void> {
    const args = ['worktree', 'remove']

    if (force) {
      args.push('--force')
    }

    args.push(path)

    await withGitRetry(() => this.git.raw(args), this.retryConfig)
  }

  /**
   * Lock a worktree so Git will not prune or move it
   */
  async lockWorktree(worktreePath: string, reason?: string): Promise<void> {
    const args = ['worktree', 'lock']
    if (reason !== undefined) {
      args.push('--reason', reason)
    }
    args.push(worktreePath)

    await withGitRetry(async () => {
      try {
        await this.git.raw(args)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        // Lifecycle cleanup may replay a completed lock operation after interruption.
        if (/is already locked\b/i.test(message)) return
        throw error
      }
    }, this.retryConfig)
  }

  /**
   * Unlock a worktree
   */
  async unlockWorktree(worktreePath: string): Promise<void> {
    await withGitRetry(async () => {
      try {
        await this.git.raw(['worktree', 'unlock', worktreePath])
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        // Lifecycle cleanup may replay a completed unlock operation after interruption.
        if (/is not locked\b/i.test(message)) return
        throw error
      }
    }, this.retryConfig)
  }

  /**
   * Get the age of a worktree, preferring its lifecycle metadata
   */
  async getWorktreeAgeMs(worktreePath: string, knownMetadata?: WorktreeMetadata): Promise<number> {
    try {
      // Callers that already read the metadata (list/health) can pass it to
      // avoid a second `git config --worktree` read per worktree.
      const { createdAt } = knownMetadata ?? (await readMetadata(worktreePath))
      if (createdAt !== undefined) {
        const createdAtMs = Date.parse(createdAt)
        const ageMs = Date.now() - createdAtMs
        if (Number.isFinite(ageMs)) return Math.max(0, ageMs)
      }
    } catch {
      // Older or partially-created worktrees may not have readable metadata.
    }

    try {
      const worktreeStat = await stat(worktreePath)
      const ageMs = Date.now() - worktreeStat.mtimeMs
      return Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0
    } catch {
      return 0
    }
  }

  /**
   * Check whether a worktree can be reaped without losing work or commits
   */
  async isReapClean(worktreePath: string, targetBranch: string): Promise<boolean> {
    try {
      const mergeTarget = targetBranch.trim()
      if (!mergeTarget) return false

      const status = await simpleGit(worktreePath).status()
      if (!status.isClean()) return false

      await this.git.raw(['show-ref', '--verify', '--quiet', `refs/heads/${mergeTarget}`])

      const worktree = (await this.listWorktrees()).find(({ path }) => path === worktreePath)
      if (!worktree?.branch) return false

      return await this.isBranchMerged(worktree.branch, `refs/heads/${mergeTarget}`)
    } catch {
      // Reaping must never proceed when repository state cannot be established.
      return false
    }
  }

  /**
   * Infer the agent session that owns a worktree
   */
  inferOwner(): string {
    // Use `||` on trimmed values so an empty/whitespace CLAUDE_SESSION_ID still
    // falls back to PANDO_SESSION (nullish-coalescing would stop at '').
    return process.env.CLAUDE_SESSION_ID?.trim() || process.env.PANDO_SESSION?.trim() || ''
  }

  /**
   * Find a worktree by branch name
   */
  async findWorktreeByBranch(branchName: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.listWorktrees()

    // Try exact match first
    const exactMatch = worktrees.find((w) => w.branch === branchName)
    if (exactMatch) {
      return exactMatch
    }

    // Try fuzzy matching (case-insensitive, partial match)
    const fuzzyMatch = worktrees.find((w) =>
      w.branch?.toLowerCase().includes(branchName.toLowerCase())
    )

    return fuzzyMatch || null
  }

  /**
   * Create a new branch
   */
  async createBranch(name: string, startPoint?: string): Promise<BranchInfo> {
    const args = ['branch', name]

    if (startPoint) {
      args.push(startPoint)
    }

    await withGitRetry(() => this.git.raw(args), this.retryConfig)

    // Get commit hash for the new branch
    const commit = await this.git.raw(['rev-parse', name])

    return {
      name,
      current: false,
      commit: commit.trim(),
      label: name,
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(name: string, force?: boolean): Promise<void> {
    const args = ['branch', force ? '-D' : '-d', name]

    try {
      await withGitRetry(() => this.git.raw(args), this.retryConfig)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes('not fully merged')) {
        throw new Error(`Branch '${name}' is not fully merged. Use force=true to delete anyway.`)
      }

      throw new Error(`Failed to delete branch '${name}': ${errorMessage}`)
    }
  }

  /**
   * List all branches
   */
  async listBranches(): Promise<BranchInfo[]> {
    const branchSummary = await this.git.branch(['-v'])
    const branches: BranchInfo[] = []

    for (const [name, branch] of Object.entries(branchSummary.branches)) {
      branches.push({
        name,
        current: branch.current,
        commit: branch.commit,
        label: branch.label,
      })
    }

    return branches
  }

  /**
   * Check if a branch exists
   */
  async branchExists(name: string): Promise<boolean> {
    try {
      await this.git.raw(['rev-parse', '--verify', `refs/heads/${name}`])
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if a branch is merged
   */
  async isBranchMerged(name: string, targetBranch?: string): Promise<boolean> {
    const target = targetBranch || 'HEAD'

    try {
      // git branch --merged returns branches that are fully merged
      const output = await this.git.raw(['branch', '--merged', target])
      const mergedBranches = output
        .split('\n')
        .map((line) => line.replace(/^[*+]?\s*/, '').trim())
        .filter(Boolean)

      return mergedBranches.includes(name)
    } catch {
      return false
    }
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const branchName = await this.git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])
      const name = branchName.trim()

      if (name === 'HEAD') {
        throw new Error('HEAD is detached (not on any branch)')
      }

      return name
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Unable to determine current branch: ${errorMessage}`)
    }
  }

  /**
   * Rebase the current branch in a worktree onto a source branch
   *
   * @param worktreePath - Path to the worktree
   * @param sourceBranch - Branch to rebase onto
   * @returns True if rebase succeeded, false if failed (conflicts, etc.)
   */
  async rebaseBranchInWorktree(worktreePath: string, sourceBranch: string): Promise<boolean> {
    try {
      const gitInWorktree = simpleGit(worktreePath)
      await gitInWorktree.rebase([sourceBranch])
      return true
    } catch {
      // Rebase failed (conflicts, divergent histories, etc.)
      // Abort the rebase to clean up the worktree state
      try {
        const gitInWorktree = simpleGit(worktreePath)
        await gitInWorktree.rebase(['--abort'])
      } catch {
        // Ignore abort errors - rebase may not have started
      }
      return false
    }
  }

  /**
   * Check if a branch exists on a remote
   *
   * @param branchName - Name of the branch to check
   * @param remote - Remote name (default: 'origin')
   * @returns True if branch exists on remote
   */
  async remoteBranchExists(branchName: string, remote: string = 'origin'): Promise<boolean> {
    try {
      await this.git.raw(['ls-remote', '--exit-code', '--heads', remote, branchName])
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete a remote branch
   *
   * @param branchName - Name of the branch to delete
   * @param remote - Remote name (default: 'origin')
   */
  async deleteRemoteBranch(branchName: string, remote: string = 'origin'): Promise<void> {
    try {
      await this.git.push([remote, '--delete', branchName])
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes('remote ref does not exist')) {
        throw new Error(`Branch '${branchName}' does not exist on remote '${remote}'`)
      }

      throw new Error(`Failed to delete remote branch '${branchName}': ${errorMessage}`)
    }
  }

  /**
   * Get the tracking remote for a branch
   *
   * @param branchName - Name of the branch
   * @returns Remote name if branch has upstream, null otherwise
   */
  async getBranchRemote(branchName: string): Promise<string | null> {
    try {
      const remote = await this.git.raw(['config', `branch.${branchName}.remote`])
      return remote.trim() || null
    } catch {
      return null
    }
  }

  /**
   * Get the full upstream tracking ref for a branch (e.g. "origin/main")
   *
   * Combines `branch.<name>.remote` (the remote, e.g. "origin") with
   * `branch.<name>.merge` (the upstream ref, e.g. "refs/heads/main"),
   * stripping the `refs/heads/` prefix. Works for any remote name.
   *
   * @param branchName - Name of the branch
   * @returns Full tracking ref (e.g. "origin/main") or null if no upstream
   */
  async getTrackingBranch(branchName: string): Promise<string | null> {
    try {
      // The two config reads are independent; run them concurrently. If either
      // rejects, Promise.all rejects and the catch below returns null.
      const [remote, merge] = await Promise.all([
        this.git.raw(['config', `branch.${branchName}.remote`]),
        this.git.raw(['config', `branch.${branchName}.merge`]),
      ])

      const remoteName = remote.trim()
      const mergeRef = merge.trim().replace(/^refs\/heads\//, '')

      if (!remoteName || !mergeRef) {
        return null
      }

      return `${remoteName}/${mergeRef}`
    } catch {
      // No upstream configured (one of the config keys is missing)
      return null
    }
  }

  /**
   * Get the commit hash for a given ref (branch, tag, or commit)
   *
   * @param ref - Git reference (branch name, tag, or commit SHA)
   * @returns Full commit SHA
   */
  async getCommitHash(ref: string): Promise<string> {
    try {
      const output = await this.git.raw(['rev-parse', ref])
      return output.trim()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Unable to resolve ref '${ref}': ${errorMessage}`)
    }
  }

  /**
   * Force update a branch to point to a specific commit
   *
   * @param branch - Name of the branch to update
   * @param commit - Commit SHA to point the branch to
   */
  async forceUpdateBranch(branch: string, commit: string): Promise<void> {
    try {
      await withGitRetry(() => this.git.raw(['branch', '-f', branch, commit]), this.retryConfig)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to update branch '${branch}': ${errorMessage}`)
    }
  }

  /**
   * Reset the current HEAD to a specific commit (hard reset)
   *
   * @param commit - Commit SHA to reset to
   */
  async resetHard(commit: string): Promise<void> {
    try {
      await withGitRetry(() => this.git.raw(['reset', '--hard', commit]), this.retryConfig)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to reset to '${commit}': ${errorMessage}`)
    }
  }

  /**
   * Set a description for a branch
   *
   * @param branch - Name of the branch
   * @param description - Description text to store
   */
  async setBranchDescription(branch: string, description: string): Promise<void> {
    try {
      await this.git.raw(['config', `branch.${branch}.description`, description])
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to set description for branch '${branch}': ${errorMessage}`)
    }
  }

  /**
   * Get the description for a branch
   *
   * @param branch - Name of the branch
   * @returns Description text or null if not set
   */
  async getBranchDescription(branch: string): Promise<string | null> {
    try {
      const output = await this.git.raw(['config', '--get', `branch.${branch}.description`])
      return output.trim() || null
    } catch {
      // Config key not set
      return null
    }
  }

  /**
   * Delete the description for a branch from git config
   *
   * @param branch - Name of the branch
   */
  async deleteBranchDescription(branch: string): Promise<void> {
    try {
      await this.git.raw(['config', '--unset', `branch.${branch}.description`])
    } catch {
      // Config key not set - ignore
    }
  }

  /**
   * List all backup branches for a given source branch
   *
   * Backup branches follow the naming convention: backup/<sourceBranch>/<timestamp>
   *
   * @param sourceBranch - Name of the source branch to find backups for
   * @returns Array of backup branch info, sorted by timestamp (newest first)
   */
  async listBackupBranches(sourceBranch: string): Promise<BackupBranchInfo[]> {
    const prefix = `backup/${sourceBranch}/`

    try {
      // Use for-each-ref to get branches and their commits efficiently
      const output = await this.git.raw([
        'for-each-ref',
        '--format=%(refname:short)%00%(objectname)',
        `refs/heads/${prefix}*`,
      ])

      if (!output.trim()) {
        return []
      }

      const lines = output.trim().split('\n')
      const backups: BackupBranchInfo[] = []

      for (const line of lines) {
        const [name, commit] = line.split('\x00')
        if (!name || !commit) continue

        // Extract timestamp from branch name
        const timestampStr = name.slice(prefix.length)
        const timestamp = this.parseBackupTimestamp(timestampStr)

        if (!timestamp) continue

        // Fetch optional message
        const message = await this.getBranchDescription(name)

        backups.push({
          name,
          sourceBranch,
          commit,
          timestamp,
          message: message ?? undefined,
        })
      }

      // Sort by timestamp, newest first
      backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      return backups
    } catch {
      // No backup branches found or other error
      return []
    }
  }

  /**
   * Parse a backup timestamp string (YYYYMMDD-HHmmss) to ISO format
   *
   * @param timestampStr - Timestamp in format YYYYMMDD-HHmmss
   * @returns ISO timestamp string or null if invalid
   */
  private parseBackupTimestamp(timestampStr: string): string | null {
    // Expected format: YYYYMMDD-HHmmss
    const match = timestampStr.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
    if (!match) return null

    const [, year, month, day, hour, minute, second] = match
    const isoStr = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`

    // Validate it's a real date
    const date = new Date(isoStr)
    if (isNaN(date.getTime())) return null

    return isoStr
  }

  /**
   * Find a worktree by exact branch name match only
   *
   * Unlike findWorktreeByBranch, this does NOT do fuzzy matching,
   * which is important for safety checks during restore operations.
   *
   * @param branchName - Exact branch name to find
   * @returns WorktreeInfo if found, null otherwise
   */
  async findWorktreeByBranchExact(branchName: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.listWorktrees()
    return worktrees.find((w) => w.branch === branchName) ?? null
  }

  /**
   * Mark files as skip-worktree to hide symlink mode changes from git status
   *
   * When files are replaced with symlinks, git sees a mode change (100644 -> 120000)
   * and reports them as modified. This method tells git to ignore these changes.
   *
   * Only paths present in the index can be marked: `git update-index --skip-worktree`
   * dies on any untracked path (e.g. a gitignored `.env` symlink), which would
   * otherwise abort the whole batch. Untracked/ignored paths never show in
   * `git status`, so they are silently filtered out rather than treated as errors.
   * Directory paths (a symlinked `.claude/`) are expanded to the tracked files
   * beneath them, since update-index cannot mark a directory.
   *
   * @param worktreePath - Path to the worktree where files reside
   * @param files - Array of relative file/directory paths to mark as skip-worktree
   * @returns Object with success status, optional error message, and count of files marked
   */
  async setSkipWorktree(
    worktreePath: string,
    files: string[]
  ): Promise<{ success: boolean; error?: string; filesMarked: number }> {
    if (files.length === 0) {
      return { success: true, filesMarked: 0 }
    }

    const gitInWorktree = simpleGit(worktreePath)

    // `:(literal)` prevents glob interpretation of file names containing *?[]
    let trackedFiles: string[]
    try {
      const pathspecs = files.map((file) => `:(literal)${file}`)
      const output = await gitInWorktree.raw(['ls-files', '-z', '--', ...pathspecs])
      trackedFiles = output.split('\0').filter((file) => file.length > 0)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg, filesMarked: 0 }
    }

    if (trackedFiles.length === 0) {
      return { success: true, filesMarked: 0 }
    }

    let filesMarked = 0
    const failedFiles: string[] = []
    // Chunk to stay clear of OS argv limits when a large directory was symlinked
    const chunkSize = 500
    for (let i = 0; i < trackedFiles.length; i += chunkSize) {
      const chunk = trackedFiles.slice(i, i + chunkSize)
      try {
        // `--` prevents a file name starting with `-` from being parsed as a flag
        await gitInWorktree.raw(['update-index', '--skip-worktree', '--', ...chunk])
        filesMarked += chunk.length
      } catch {
        // Batch failed - retry per file so one bad path cannot abort the rest
        for (const file of chunk) {
          try {
            await gitInWorktree.raw(['update-index', '--skip-worktree', '--', file])
            filesMarked++
          } catch {
            failedFiles.push(file)
          }
        }
      }
    }

    if (failedFiles.length > 0) {
      const shown = failedFiles.slice(0, 5).join(', ')
      const more = failedFiles.length > 5 ? ` (+${failedFiles.length - 5} more)` : ''
      return {
        success: false,
        error: `Failed to mark ${failedFiles.length} file(s) as skip-worktree: ${shown}${more}`,
        filesMarked,
      }
    }

    return { success: true, filesMarked }
  }

  /**
   * List untracked files in a worktree that are gitignored.
   *
   * This is the safe rsync set for new worktrees: gitignored artifacts (.venv,
   * node_modules, build caches) are expensive to rebuild and never show in
   * `git status`. Tracked files come from git checkout, and non-ignored
   * untracked files (WIP) are deliberately excluded so the new worktree's
   * status stays clean.
   *
   * @param worktreePath - Path to the worktree to scan
   * @returns Relative paths of all gitignored untracked files
   */
  async listIgnoredFiles(worktreePath: string): Promise<string[]> {
    const gitInWorktree = simpleGit(worktreePath)
    const output = await gitInWorktree.raw([
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
    ])
    return output.split('\0').filter((file) => file.length > 0)
  }

  /**
   * Return the subset of the given relative paths that are git-tracked in the
   * worktree. A directory counts as tracked when any tracked file lives under it.
   *
   * @param worktreePath - Path to the worktree whose index is consulted
   * @param paths - Relative file or directory paths to check
   * @returns The tracked subset, in input order
   */
  async filterTrackedPaths(worktreePath: string, paths: string[]): Promise<string[]> {
    if (paths.length === 0) {
      return []
    }

    const gitInWorktree = simpleGit(worktreePath)
    // `:(literal)` prevents glob interpretation of file names containing *?[]
    const pathspecs = paths.map((p) => `:(literal)${p}`)
    const output = await gitInWorktree.raw(['ls-files', '-z', '--', ...pathspecs])
    const trackedEntries = output.split('\0').filter((file) => file.length > 0)

    return paths.filter((p) =>
      trackedEntries.some((entry) => entry === p || entry.startsWith(`${p}/`))
    )
  }

  /**
   * List paths that show up in `git status` for a worktree (modified, deleted,
   * type-changed, or untracked). Files marked skip-worktree are hidden by git
   * itself, so they never appear here.
   *
   * @param worktreePath - Path to the worktree to check
   * @returns Relative paths of dirty entries; empty for a clean tree
   */
  async getDirtyPaths(worktreePath: string): Promise<string[]> {
    const gitInWorktree = simpleGit(worktreePath)
    const status = await gitInWorktree.status()
    return status.files.map((file) => file.path)
  }

  /**
   * Count commits between two refs using rev-list
   *
   * @param from - Starting ref (exclusive)
   * @param to - Ending ref (inclusive, defaults to HEAD)
   * @returns Number of commits from..to, or null if unable to count
   */
  async countCommitsBetween(from: string, to: string = 'HEAD'): Promise<number | null> {
    try {
      const output = await this.git.raw(['rev-list', '--count', `${from}..${to}`])
      const count = parseInt(output.trim(), 10)
      return isNaN(count) ? null : count
    } catch {
      return null
    }
  }

  /**
   * Fetch from remote with pruning to update remote tracking branch state
   *
   * @param remote - Remote name (default: 'origin')
   */
  async fetchWithPrune(remote: string = 'origin'): Promise<void> {
    await withGitRetry(() => this.git.fetch([remote, '--prune']), this.retryConfig)
  }

  /**
   * Detect the main branch name (main or master)
   *
   * @returns Main branch name
   */
  async getMainBranch(): Promise<string> {
    try {
      await this.git.raw(['rev-parse', '--verify', 'refs/heads/main'])
      return 'main'
    } catch {
      try {
        await this.git.raw(['rev-parse', '--verify', 'refs/heads/master'])
        return 'master'
      } catch {
        // Default to 'main' if neither exists
        return 'main'
      }
    }
  }

  /**
   * Get commit log entries between two refs
   *
   * Returns commits reachable from `to` but not from `from`.
   * Equivalent to `git log from..to --format=%h %s`
   *
   * @param from - Starting ref (exclusive)
   * @param to - Ending ref (inclusive)
   * @param limit - Maximum number of commits to return (default: 10)
   * @returns Object with commits array and total count, or null on git failure
   */
  async getCommitLogBetween(
    from: string,
    to: string,
    limit: number = 10
  ): Promise<{ commits: CommitLogEntry[]; totalCount: number } | null> {
    try {
      // First get total count
      const countOutput = await this.git.raw(['rev-list', '--count', `${from}..${to}`, '--'])
      const totalCount = parseInt(countOutput.trim(), 10)

      if (isNaN(totalCount) || totalCount === 0) {
        return { commits: [], totalCount: 0 }
      }

      // Get commit details with limit
      const logOutput = await this.git.raw([
        'log',
        `${from}..${to}`,
        '--format=%h %s',
        `-n`,
        String(limit),
        '--',
      ])

      if (!logOutput.trim()) {
        return { commits: [], totalCount }
      }

      const commits: CommitLogEntry[] = logOutput
        .trim()
        .split('\n')
        .map((line) => {
          const spaceIndex = line.indexOf(' ')
          if (spaceIndex === -1) {
            return { hash: line, message: '' }
          }
          return {
            hash: line.substring(0, spaceIndex),
            message: line.substring(spaceIndex + 1),
          }
        })

      return { commits, totalCount }
    } catch {
      return null
    }
  }

  /**
   * Get list of branches merged into target branch
   *
   * @param targetBranch - Branch to check merges against
   * @returns Array of merged branch names
   */
  async getMergedBranches(targetBranch: string = 'main'): Promise<string[]> {
    try {
      const output = await this.git.raw(['branch', '--merged', targetBranch])
      return output
        .split('\n')
        .map((line: string) => line.trim().replace(/^\*\s*/, ''))
        .filter((name: string) => name && name !== targetBranch)
    } catch {
      // If target branch doesn't exist, try 'master' as fallback
      if (targetBranch === 'main') {
        try {
          return await this.getMergedBranches('master')
        } catch {
          return []
        }
      }
      return []
    }
  }

  /**
   * Get branches whose upstream tracking branch no longer exists
   * Uses git for-each-ref to detect [gone] status
   *
   * @returns Map of branch name to tracking branch reference
   */
  async getGoneBranches(): Promise<Map<string, string>> {
    const goneBranches = new Map<string, string>()

    try {
      // Format: "branch-name [gone]" or "branch-name [ahead 1, behind 2]" or "branch-name "
      const output = await this.git.raw([
        'for-each-ref',
        '--format=%(refname:short) %(upstream:track)',
        'refs/heads/',
      ])

      for (const line of output.split('\n')) {
        if (line.includes('[gone]')) {
          const match = line.match(/^(\S+)\s+\[gone\]/)
          const branchName = match?.[1]
          if (branchName) {
            // Get the tracking branch reference for display
            try {
              const upstream = await this.git.raw(['config', `branch.${branchName}.merge`])
              goneBranches.set(branchName, upstream.trim())
            } catch {
              goneBranches.set(branchName, 'unknown')
            }
          }
        }
      }
    } catch {
      // If for-each-ref fails, return empty map
    }

    return goneBranches
  }

  /**
   * Get worktrees that are stale (merged, gone, or prunable)
   *
   * Detection priority: prunable > gone > merged
   * Main worktree is always excluded from results.
   *
   * @param targetBranch - Branch to check merges against (default: auto-detect main/master)
   * @returns Array of stale worktrees with reason and metadata
   */
  async getStaleWorktrees(targetBranch?: string): Promise<StaleWorktreeInfo[]> {
    // 1. Get all worktrees
    const worktrees = await this.listWorktrees()

    // 2. Determine target branch for merge check
    const mergeTarget = targetBranch || (await this.getMainBranch())

    // 3. Get merged branches
    const mergedBranches = await this.getMergedBranches(mergeTarget)

    // 4. Get gone branches
    const goneBranches = await this.getGoneBranches()

    // 5. Get main worktree path to exclude it
    const mainWorktreePath = await this.getMainWorktreePath()

    // 6. Enrich worktrees with stale information
    const staleWorktrees: StaleWorktreeInfo[] = []

    for (const worktree of worktrees) {
      // Skip main worktree - never clean it
      if (worktree.path === mainWorktreePath) {
        continue
      }

      // Determine stale reason (priority: prunable > gone > merged)
      let staleReason: 'merged' | 'gone' | 'prunable' | null = null
      let trackingBranch: string | undefined

      if (worktree.isPrunable) {
        staleReason = 'prunable'
      } else if (worktree.branch && goneBranches.has(worktree.branch)) {
        staleReason = 'gone'
        trackingBranch = goneBranches.get(worktree.branch)
      } else if (worktree.branch && mergedBranches.includes(worktree.branch)) {
        staleReason = 'merged'
      }

      // Only include worktrees that are actually stale
      if (staleReason !== null) {
        // Check for uncommitted changes (skip for prunable - no directory exists)
        const hasUncommittedChanges =
          staleReason === 'prunable' ? false : await this.hasUncommittedChanges(worktree.path)

        staleWorktrees.push({
          ...worktree,
          staleReason,
          hasUncommittedChanges,
          trackingBranch,
        })
      }
    }

    return staleWorktrees
  }
}

/**
 * Create a new GitHelper instance
 */
export function createGitHelper(baseDir?: string, retryConfig?: GitRetryOptions): GitHelper {
  return new GitHelper(baseDir, retryConfig)
}
