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
 * Stale worktree information with detection reason
 */
export interface StaleWorktreeInfo extends WorktreeInfo {
  staleReason: 'merged' | 'gone' | 'prunable' | null
  hasUncommittedChanges: boolean
  trackingBranch?: string
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
   * Fetch from remote with pruning to update remote tracking branch state
   *
   * @param remote - Remote name (default: 'origin')
   */
  async fetchWithPrune(remote: string = 'origin'): Promise<void> {
    await this.git.fetch([remote, '--prune'])
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
export function createGitHelper(baseDir?: string): GitHelper {
  return new GitHelper(baseDir)
}
