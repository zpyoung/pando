import simpleGit, { SimpleGit } from 'simple-git'

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
    // TODO: Implement repository validation
    // Use simple-git to check if current directory is a git repo
    throw new Error('Not implemented')
  }

  /**
   * Get the root directory of the git repository
   */
  async getRepositoryRoot(): Promise<string> {
    // TODO: Implement repository root discovery
    // 1. Execute git rev-parse --show-toplevel
    // 2. Return the path
    // 3. Handle errors (not a git repo)
    // Used to find config files and determine source tree location
    throw new Error('Not implemented')
  }

  /**
   * Get the main worktree path (source for rsync operations)
   */
  async getMainWorktreePath(): Promise<string> {
    // TODO: Implement main worktree detection
    // 1. Execute git worktree list --porcelain
    // 2. Parse output to find the main worktree (first one, no "branch" line)
    // 3. Return its path
    // Needed as source for rsync operations when creating new worktrees
    throw new Error('Not implemented')
  }

  /**
   * Add a new worktree
   */
  async addWorktree(
    path: string,
    options?: { branch?: string; commit?: string; skipPostCreate?: boolean }
  ): Promise<WorktreeInfo> {
    // TODO: Implement worktree add
    // 1. Build command arguments
    // 2. Execute git worktree add
    // 3. Parse and return worktree info
    // skipPostCreate flag added for integration with rsync/symlink setup
    throw new Error('Not implemented')
  }

  /**
   * List all worktrees
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    // TODO: Implement worktree list
    // 1. Execute git worktree list --porcelain
    // 2. Parse output into structured data
    // 3. Return array of worktree info
    throw new Error('Not implemented')
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(path: string, force?: boolean): Promise<void> {
    // TODO: Implement worktree remove
    // 1. Execute git worktree remove with optional --force
    // 2. Handle errors appropriately
    throw new Error('Not implemented')
  }

  /**
   * Find a worktree by branch name
   */
  async findWorktreeByBranch(branchName: string): Promise<WorktreeInfo | null> {
    // TODO: Implement worktree lookup by branch
    // 1. List all worktrees
    // 2. Find matching branch (with fuzzy matching support)
    // 3. Return worktree info or null
    throw new Error('Not implemented')
  }

  /**
   * Create a new branch
   */
  async createBranch(name: string, startPoint?: string): Promise<BranchInfo> {
    // TODO: Implement branch creation
    // 1. Execute git branch or git checkout -b
    // 2. Return branch info
    throw new Error('Not implemented')
  }

  /**
   * Delete a branch
   */
  async deleteBranch(name: string, force?: boolean): Promise<void> {
    // TODO: Implement branch deletion
    // 1. Execute git branch -d or -D (if force)
    // 2. Handle errors appropriately
    throw new Error('Not implemented')
  }

  /**
   * List all branches
   */
  async listBranches(): Promise<BranchInfo[]> {
    // TODO: Implement branch listing
    // 1. Execute git branch -v or similar
    // 2. Parse output into structured data
    // 3. Return array of branch info
    throw new Error('Not implemented')
  }

  /**
   * Check if a branch exists
   */
  async branchExists(name: string): Promise<boolean> {
    // TODO: Implement branch existence check
    throw new Error('Not implemented')
  }

  /**
   * Check if a branch is merged
   */
  async isBranchMerged(name: string, targetBranch?: string): Promise<boolean> {
    // TODO: Implement merge status check
    // Used for safe deletion
    throw new Error('Not implemented')
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(): Promise<string> {
    // TODO: Implement current branch retrieval
    throw new Error('Not implemented')
  }
}

/**
 * Create a new GitHelper instance
 */
export function createGitHelper(baseDir?: string): GitHelper {
  return new GitHelper(baseDir)
}
