import { Args, Command, Flags } from '@oclif/core'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { jsonFlag, pathFlag } from '../utils/common-flags.js'
import { ErrorHelper, isOclifExitError } from '../utils/errors.js'
import { createGitHelper, type WorktreeInfo } from '../utils/git.js'

function canonicalizePath(targetPath: string): string {
  const resolvedPath = path.resolve(targetPath)
  try {
    return realpathSync.native(resolvedPath)
  } catch {
    return resolvedPath
  }
}

export function resolveLockTarget(
  target: string,
  worktrees: WorktreeInfo[],
  repositoryRoot: string,
  cwd = process.cwd()
): WorktreeInfo | null {
  const possiblePaths = new Set([
    canonicalizePath(path.resolve(cwd, target)),
    canonicalizePath(path.resolve(repositoryRoot, target)),
  ])
  const pathMatch = worktrees.find((worktree) => possiblePaths.has(canonicalizePath(worktree.path)))
  if (pathMatch) return pathMatch

  return worktrees.find((worktree) => worktree.branch === target) ?? null
}

export default class LockWorktree extends Command {
  static description = 'Lock a Git worktree against pruning or moving'

  static examples = [
    '<%= config.bin %> <%= command.id %> ../feature-x',
    '<%= config.bin %> <%= command.id %> feature/x --reason "active session"',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --json',
  ]

  static args = {
    worktree: Args.string({
      description: 'Worktree path or branch name',
      required: false,
    }),
  }

  static flags = {
    path: pathFlag,
    reason: Flags.string({
      description: 'Reason recorded with the Git worktree lock',
    }),
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LockWorktree)

    try {
      if (flags.path !== undefined && args.worktree !== undefined) {
        ErrorHelper.validation(this, 'Specify a worktree argument or --path, not both.', flags.json)
      }

      const target = flags.path ?? args.worktree
      if (target === undefined || target.trim() === '') {
        ErrorHelper.validation(this, 'A worktree path or branch name is required.', flags.json)
      }

      const gitHelper = createGitHelper()
      if (!(await gitHelper.isRepository())) {
        ErrorHelper.validation(this, 'Not a git repository', flags.json)
      }

      const repositoryRoot = await gitHelper.getRepositoryRoot()
      const worktrees = await gitHelper.listWorktrees()
      const worktree = resolveLockTarget(target, worktrees, repositoryRoot)
      if (!worktree) {
        ErrorHelper.validation(this, `Worktree not found: ${target}`, flags.json)
      }

      await gitHelper.lockWorktree(worktree.path, flags.reason)

      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: true,
              path: worktree.path,
              branch: worktree.branch,
              reason: flags.reason ?? null,
              locked: true,
            },
            null,
            2
          )
        )
      } else {
        const chalk = (await import('chalk')).default
        this.log(chalk.green(`✓ Locked worktree ${worktree.path}`))
      }
    } catch (error) {
      if (isOclifExitError(error)) throw error
      ErrorHelper.operation(
        this,
        error instanceof Error ? error : new Error(String(error)),
        'Failed to lock worktree',
        flags.json
      )
    }
  }
}
