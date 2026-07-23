import { Command, Flags } from '@oclif/core'
import { createGitHelper, type WorktreeInfo } from '../utils/git.js'
import { jsonFlag } from '../utils/common-flags.js'
import { ErrorHelper } from '../utils/errors.js'
import { readMetadata, type WorktreeMetadata } from '../utils/worktreeMetadata.js'

interface LifecycleWorktreeInfo extends Omit<WorktreeInfo, 'isLocked'> {
  kind: WorktreeMetadata['kind'] | null
  createdAt: string | null
  owner: string | null
  ttl: string | null
  ageMs: number
  locked: boolean
}

function formatAge(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

async function addLifecycleDetails(
  worktrees: WorktreeInfo[],
  gitHelper: ReturnType<typeof createGitHelper>
): Promise<LifecycleWorktreeInfo[]> {
  return Promise.all(
    worktrees.map(async ({ isLocked, ...worktree }) => {
      const metadata = await readMetadata(worktree.path)
      const ageMs = await gitHelper.getWorktreeAgeMs(worktree.path, metadata)
      return {
        ...worktree,
        kind: metadata.kind ?? null,
        createdAt: metadata.createdAt ?? null,
        owner: metadata.owner ?? null,
        ttl: metadata.ttl ?? null,
        ageMs,
        locked: Boolean(isLocked),
      }
    })
  )
}

/**
 * List all git worktrees
 *
 * Displays information about all worktrees associated with
 * the current repository, including paths, branches, and commit hashes.
 */
export default class ListWorktree extends Command {
  static description = 'List all git worktrees'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --verbose',
  ]

  static flags = {
    json: jsonFlag,
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed information',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ListWorktree)

    try {
      // 1. Validate the repository is a git repo
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()

      if (!isRepo) {
        ErrorHelper.validation(
          this,
          'Not a git repository. Run this command from within a git repository.',
          flags.json as boolean | undefined
        )
      }

      // 2. Execute git worktree list command and parse output
      const worktrees = await gitHelper.listWorktrees()

      // 3. Handle edge case: no worktrees
      if (worktrees.length === 0) {
        if (flags.json) {
          this.log(JSON.stringify({ worktrees: [] }))
        } else {
          const chalk = (await import('chalk')).default
          this.log(chalk.yellow('No worktrees found'))
        }
        return
      }

      const worktreesWithLifecycle = await addLifecycleDetails(worktrees, gitHelper)

      // 4-5. Format and output based on flags
      if (flags.json) {
        // JSON output
        this.log(JSON.stringify({ worktrees: worktreesWithLifecycle }, null, 2))
      } else {
        // Human-readable output with chalk
        const chalk = (await import('chalk')).default
        this.log(chalk.bold(`Found ${worktreesWithLifecycle.length} worktree(s):\n`))

        for (const worktree of worktreesWithLifecycle) {
          // Path (always show)
          this.log(chalk.cyan(`  ${worktree.path}`))

          // Branch
          if (worktree.branch) {
            this.log(chalk.green(`    Branch: ${worktree.branch}`))
          } else {
            this.log(chalk.yellow(`    Branch: (detached HEAD)`))
          }

          // Verbose mode: show commit hash and prunable status
          if (flags.verbose) {
            this.log(chalk.gray(`    Commit: ${worktree.commit}`))
            this.log(
              chalk.gray(
                `    Lifecycle: kind ${worktree.kind ?? 'unknown'}, owner ${worktree.owner ?? '-'}, age ${formatAge(worktree.ageMs)}, ${worktree.locked ? 'locked' : 'unlocked'}`
              )
            )
            if (worktree.isPrunable) {
              this.log(chalk.red(`    Status: prunable (directory deleted)`))
            }
          }

          // Show prunable warning even in non-verbose mode
          if (!flags.verbose && worktree.isPrunable) {
            this.log(chalk.red(`    ⚠ Prunable (directory deleted)`))
          }

          this.log('') // Empty line between entries
        }
      }
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        'Failed to list worktrees',
        flags.json as boolean | undefined
      )
    }
  }
}
