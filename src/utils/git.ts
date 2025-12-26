import { simpleGit, type SimpleGit } from 'simple-git'

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

export class GitHelper {
  private git: SimpleGit

  constructor(baseDir?: string) {
    this.git = simpleGit(baseDir)
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
    await this.git.raw(args)

    // Get the commit hash for the new worktree
    const commitHash = await this.git.raw(['rev-parse', 'HEAD'])

    // Determine if this was an existing branch checkout (not new creation or force reset)
    const isExistingBranch = branchExists && !options?.force

    return {
      path,
      branch: options?.branch || null,
      commit: commitHash.trim(),
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
      } else if (line === '' && currentWorktree.path) {
        // Empty line marks end of worktree entry
        worktrees.push({
          path: currentWorktree.path,
          branch: currentWorktree.branch || null,
          commit: currentWorktree.commit || '',
          isPrunable: currentWorktree.isPrunable || false,
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
      })
    }

    return worktrees
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
   * Remove a worktree
   */
  async removeWorktree(path: string, force?: boolean): Promise<void> {
    const args = ['worktree', 'remove']

    if (force) {
      args.push('--force')
    }

    args.push(path)

    await this.git.raw(args)
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

    await this.git.raw(args)

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
      await this.git.raw(args)
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
        .map((line) => line.trim().replace(/^\*\s*/, ''))
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
      await this.git.raw(['branch', '-f', branch, commit])
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
      await this.git.raw(['reset', '--hard', commit])
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
   * @param worktreePath - Path to the worktree where files reside
   * @param files - Array of relative file paths to mark as skip-worktree
   * @returns Object with success status, optional error message, and count of files marked
   */
  async setSkipWorktree(
    worktreePath: string,
    files: string[]
  ): Promise<{ success: boolean; error?: string; filesMarked: number }> {
    if (files.length === 0) {
      return { success: true, filesMarked: 0 }
    }

    try {
      const gitInWorktree = simpleGit(worktreePath)
      await gitInWorktree.raw(['update-index', '--skip-worktree', ...files])
      return { success: true, filesMarked: files.length }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg, filesMarked: 0 }
    }
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
}

/**
 * Create a new GitHelper instance
 */
export function createGitHelper(baseDir?: string): GitHelper {
  return new GitHelper(baseDir)
}
