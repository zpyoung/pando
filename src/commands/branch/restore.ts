import { Command, Flags } from '@oclif/core'
import { select, confirm } from '@inquirer/prompts'
import { createGitHelper, type BackupBranchInfo } from '../../utils/git.js'
import {
  isBackupOf,
  formatRelativeTime,
  parseBackupTimestamp,
  BACKUP_PREFIX,
} from '../../utils/branch-backups.js'
import { jsonFlag, forceFlag } from '../../utils/common-flags.js'
import { ErrorHelper } from '../../utils/errors.js'

/**
 * Result data for a successful restore operation
 */
export interface RestoreResult {
  /** The branch that was restored */
  branch: string
  /** The backup branch that was used for restoration */
  backup: string
  /** Commit SHA before the restore */
  previousCommit: string
  /** Commit SHA after the restore (same as backup's commit) */
  newCommit: string
  /** Whether the backup branch was deleted after restore */
  backupDeleted: boolean
}

/**
 * Restore a branch to a previous backup state
 *
 * Resets the target branch to match the commit of a selected backup branch.
 * Supports both interactive selection and explicit backup specification.
 *
 * @example
 * # Interactive restore of current branch
 * pando branch restore
 *
 * # Restore a specific branch with explicit backup
 * pando branch restore --branch main --backup backup/main/20250117-153045
 *
 * # Force restore and delete backup afterward
 * pando branch restore --backup backup/feature/20250117-100000 --force --delete-backup
 */
export default class BranchRestore extends Command {
  static description = 'Restore a branch from a backup'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --backup backup/main/20250117-153045',
    '<%= config.bin %> <%= command.id %> --branch main --backup backup/main/20250117-153045 --force',
    '<%= config.bin %> <%= command.id %> --backup backup/feature/20250117-100000 -f -d --json',
  ]

  static flags = {
    branch: Flags.string({
      char: 'b',
      description: 'Target branch to restore (default: current branch)',
      required: false,
    }),
    backup: Flags.string({
      description: 'Backup branch to restore from (interactive selection if omitted)',
      required: false,
    }),
    force: forceFlag,
    'delete-backup': Flags.boolean({
      char: 'd',
      description: 'Delete the backup branch after successful restore',
      default: false,
    }),
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(BranchRestore)

    const gitHelper = createGitHelper()

    // Step 1: Validate git repository
    const isRepo = await gitHelper.isRepository()
    if (!isRepo) {
      ErrorHelper.validation(
        this,
        'Not a git repository. Run this command from within a git repository.',
        flags.json
      )
      return
    }

    // Step 2: Determine target branch
    let targetBranch: string
    if (flags.branch) {
      targetBranch = flags.branch
    } else {
      try {
        targetBranch = await gitHelper.getCurrentBranch()
      } catch {
        ErrorHelper.validation(
          this,
          'Cannot determine current branch (HEAD is detached).\n\n' +
            'Options:\n' +
            '  • Use --branch <name> to specify the branch to restore\n' +
            '  • Checkout a branch first: git checkout <branch>',
          flags.json
        )
        return
      }
    }

    // Step 3: Validate target branch exists
    const branchExists = await gitHelper.branchExists(targetBranch)
    if (!branchExists) {
      ErrorHelper.validation(
        this,
        `Branch '${targetBranch}' does not exist.\n\n` +
          'Use --branch to specify an existing branch.',
        flags.json
      )
      return
    }

    // Step 4: Discover backups for target branch
    const backups = await gitHelper.listBackupBranches(targetBranch)
    if (backups.length === 0) {
      ErrorHelper.validation(
        this,
        `No backups found for branch '${targetBranch}'.\n\n` +
          'Create a backup first with: pando branch backup',
        flags.json
      )
      return
    }

    // Step 5: Choose backup
    let selectedBackup: BackupBranchInfo

    if (flags.backup) {
      // Validate --backup flag value
      if (!flags.backup.startsWith(`${BACKUP_PREFIX}${targetBranch}/`)) {
        ErrorHelper.validation(
          this,
          `Backup '${flags.backup}' is not a backup of branch '${targetBranch}'.\n\n` +
            `Expected format: backup/${targetBranch}/<timestamp>`,
          flags.json
        )
        return
      }

      // Check if it's a valid backup for this branch
      if (!isBackupOf(flags.backup, targetBranch)) {
        ErrorHelper.validation(
          this,
          `'${flags.backup}' is not a valid backup branch name.\n\n` +
            `Expected format: backup/${targetBranch}/<YYYYMMDD-HHmmss>`,
          flags.json
        )
        return
      }

      // Find the backup in our list
      const found = backups.find((b) => b.name === flags.backup)
      if (!found) {
        ErrorHelper.validation(
          this,
          `Backup '${flags.backup}' does not exist.\n\n` +
            `Available backups for '${targetBranch}':\n` +
            backups.map((b) => `  • ${b.name}`).join('\n'),
          flags.json
        )
        return
      }

      selectedBackup = found
    } else if (flags.json) {
      // JSON mode requires explicit backup specification
      ErrorHelper.validation(
        this,
        '--backup is required when using --json output.\n\n' +
          `Available backups for '${targetBranch}':\n` +
          backups.map((b) => `  • ${b.name}`).join('\n'),
        flags.json
      )
      return
    } else {
      // Interactive selection
      selectedBackup = await this.selectBackup(backups)
    }

    // Step 6: Safety checks
    let currentBranch: string | null = null
    try {
      currentBranch = await gitHelper.getCurrentBranch()
    } catch {
      // Detached HEAD - not on any branch
    }

    const isCurrentBranch = currentBranch === targetBranch

    if (isCurrentBranch) {
      // Restoring the checked-out branch - check for uncommitted changes
      const hasChanges = await gitHelper.hasUncommittedChanges(process.cwd())
      if (hasChanges) {
        ErrorHelper.validation(
          this,
          'Cannot restore: working tree has uncommitted changes.\n\n' +
            'Options:\n' +
            '  • Commit or stash your changes first\n' +
            '  • Use git reset --hard to discard changes',
          flags.json
        )
        return
      }
    } else {
      // Restoring a different branch - check if it's checked out in another worktree
      const worktree = await gitHelper.findWorktreeByBranchExact(targetBranch)
      if (worktree) {
        ErrorHelper.validation(
          this,
          `Cannot restore: branch '${targetBranch}' is checked out in worktree at:\n` +
            `  ${worktree.path}\n\n` +
            'Options:\n' +
            `  • Switch to that worktree and run: pando branch restore\n` +
            '  • Remove the worktree first',
          flags.json
        )
        return
      }
    }

    // Step 7: Get current commit for comparison
    let previousCommit: string
    try {
      previousCommit = await gitHelper.getCommitHash(targetBranch)
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        `Failed to get current commit for '${targetBranch}'`,
        flags.json
      )
      return
    }

    // Step 8: Confirmation prompt (unless --force or --json)
    if (!flags.force && !flags.json) {
      const confirmed = await this.confirmRestore(
        targetBranch,
        selectedBackup,
        previousCommit,
        isCurrentBranch,
        gitHelper
      )
      if (!confirmed) {
        this.log('Restore cancelled.')
        return
      }
    }

    // Step 9: Perform the restore
    try {
      if (isCurrentBranch) {
        // Reset current branch
        await gitHelper.resetHard(selectedBackup.commit)
      } else {
        // Force update another branch
        await gitHelper.forceUpdateBranch(targetBranch, selectedBackup.commit)
      }
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        `Failed to restore branch '${targetBranch}'`,
        flags.json
      )
      return
    }

    // Step 10: Optionally delete backup
    let backupDeleted = false
    let deleteWarning: string | undefined

    if (flags['delete-backup']) {
      try {
        await gitHelper.deleteBranch(selectedBackup.name, true)
        backupDeleted = true
      } catch (error) {
        // Warn but don't fail - restore succeeded
        deleteWarning = `Failed to delete backup: ${(error as Error).message}`
      }
    }

    // Step 11: Format and output result
    const result: RestoreResult = {
      branch: targetBranch,
      backup: selectedBackup.name,
      previousCommit,
      newCommit: selectedBackup.commit,
      backupDeleted,
    }

    await this.formatOutput(flags.json, result, deleteWarning)
  }

  /**
   * Interactive backup selection
   */
  private async selectBackup(backups: BackupBranchInfo[]): Promise<BackupBranchInfo> {
    const choices = backups.map((backup) => {
      const timestampDate =
        parseBackupTimestamp(
          backup.timestamp
            .replace(/-/g, '')
            .replace('T', '-')
            .replace(':', '')
            .replace(':', '')
            .replace('Z', '')
        ) ?? parseBackupTimestampFromName(backup.name)
      const relativeTime = timestampDate ? formatRelativeTime(timestampDate) : backup.timestamp
      const messageHint = backup.message ? ` - ${backup.message}` : ''

      return {
        name: `${backup.name} (${relativeTime})${messageHint}`,
        value: backup,
        description: `Commit: ${backup.commit.substring(0, 7)}`,
      }
    })

    return select({
      message: 'Select a backup to restore from:',
      choices,
    })
  }

  /**
   * Confirmation prompt before restore
   */
  private async confirmRestore(
    targetBranch: string,
    backup: BackupBranchInfo,
    previousCommit: string,
    isCurrentBranch: boolean,
    gitHelper: ReturnType<typeof createGitHelper>
  ): Promise<boolean> {
    const chalk = (await import('chalk')).default

    const lines: string[] = []
    lines.push('')
    lines.push(chalk.yellow('⚠ Warning: This will reset the branch to a previous state.'))
    lines.push('')
    lines.push(`  Branch:          ${chalk.cyan(targetBranch)}`)
    lines.push(`  Current commit:  ${chalk.gray(previousCommit.substring(0, 7))}`)
    lines.push(`  Backup commit:   ${chalk.gray(backup.commit.substring(0, 7))}`)

    if (backup.message) {
      lines.push(`  Backup message:  ${chalk.gray(backup.message)}`)
    }

    // Best-effort: show commits that may become unreachable
    if (isCurrentBranch) {
      const commitCount = await gitHelper.countCommitsBetween(backup.commit, 'HEAD')
      if (commitCount !== null && commitCount > 0) {
        lines.push('')
        lines.push(
          chalk.yellow(`  ${commitCount} commit(s) will become unreachable and may be lost.`)
        )
      }
    }

    lines.push('')
    this.log(lines.join('\n'))

    return confirm({
      message: 'Are you sure you want to restore?',
      default: false,
    })
  }

  /**
   * Format and output the restore result
   */
  private async formatOutput(
    isJson: boolean,
    result: RestoreResult,
    warning?: string
  ): Promise<void> {
    if (isJson) {
      const output: Record<string, unknown> = {
        status: warning ? 'warning' : 'success',
        restore: result,
      }
      if (warning) {
        output.warning = warning
      }
      this.log(JSON.stringify(output, null, 2))
    } else {
      const chalk = (await import('chalk')).default
      const lines: string[] = []

      lines.push(chalk.green(`✓ Restored '${result.branch}' from backup`))
      lines.push(chalk.gray(`  Backup:          ${result.backup}`))
      lines.push(chalk.gray(`  Previous commit: ${result.previousCommit.substring(0, 7)}`))
      lines.push(chalk.gray(`  New commit:      ${result.newCommit.substring(0, 7)}`))

      if (result.backupDeleted) {
        lines.push(chalk.gray('  Backup deleted:  yes'))
      }

      if (warning) {
        lines.push('')
        lines.push(chalk.yellow(`⚠ ${warning}`))
      }

      this.log(lines.join('\n'))
    }
  }
}

/**
 * Helper to parse timestamp from backup branch name
 */
function parseBackupTimestampFromName(branchName: string): Date | null {
  // Extract timestamp from format: backup/<branch>/<YYYYMMDD-HHmmss>
  const lastSlash = branchName.lastIndexOf('/')
  if (lastSlash === -1) return null

  const timestampStr = branchName.slice(lastSlash + 1)
  return parseBackupTimestamp(timestampStr)
}
