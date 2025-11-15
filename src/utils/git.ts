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
}

export interface BranchInfo {
  name: string
  current: boolean
  commit: string
  label: string
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
   */
  async addWorktree(
    path: string,
    options?: { branch?: string; commit?: string; skipPostCreate?: boolean }
  ): Promise<WorktreeInfo> {
    const args = ['worktree', 'add']

    // Add branch option if specified
    if (options?.branch) {
      args.push('-b', options.branch)
    }

    // Add path
    args.push(path)

    // Add commit/branch reference if specified
    if (options?.commit) {
      args.push(options.commit)
    }

    // Execute worktree add command
    await this.git.raw(args)

    // Get the commit hash for the new worktree
    const commitHash = await this.git.raw(['rev-parse', 'HEAD'])

    return {
      path,
      branch: options?.branch || null,
      commit: commitHash.trim(),
      isPrunable: false,
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
}

/**
 * Create a new GitHelper instance
 */
export function createGitHelper(baseDir?: string): GitHelper {
  return new GitHelper(baseDir)
}
