import { Command, Flags } from '@oclif/core'
import { createGitHelper, type BackupBranchInfo, type GitHelper } from '../../utils/git.js'
import {
  generateBackupBranchName,
  toIsoSeconds,
  formatRelativeTime,
  parseBackupTimestamp,
} from '../../utils/branch-backups.js'
import { jsonFlag, forceFlag } from '../../utils/common-flags.js'
import { ErrorHelper } from '../../utils/errors.js'

/**
 * Result data for a successful backup creation
 */
export interface BackupCreateResult {
  /** Full backup branch name (e.g., backup/feature/20250117-153045) */
  name: string
  /** The source branch that was backed up */
  sourceBranch: string
  /** Commit SHA the backup points to */
  commit: string
  /** Optional user-provided message stored in branch description */
  message?: string
  /** ISO timestamp when backup was created */
  timestamp: string
}

/**
 * Result for a single backup deletion
 */
export interface BackupDeleteResult {
  /** Name of the deleted backup branch */
  name: string
  /** Whether deletion succeeded */
  deleted: boolean
  /** Error message if deletion failed */
  error?: string
}

/**
 * Result data for a backup clear operation
 */
export interface BackupClearResult {
  /** The source branch whose backups were cleared */
  sourceBranch: string
  /** Total number of backups that were targeted for deletion */
  totalBackups: number
  /** Number of backups successfully deleted */
  deletedCount: number
  /** Number of backups that failed to delete */
  failedCount: number
  /** Details for each backup deletion */
  deleted: BackupDeleteResult[]
}

/**
 * Create or clear timestamped backup branches
 *
 * Backup branches follow the naming convention: backup/<sourceBranch>/<timestamp>
 * where timestamp is UTC YYYYMMDD-HHmmss.
 *
 * @example
 * # Backup the current branch
 * pando branch backup
 *
 * # Backup with a message
 * pando branch backup -m "Before risky refactor"
 *
 * # Backup a specific branch
 * pando branch backup --branch main
 *
 * # Clear (delete) backups interactively
 * pando branch backup --clear
 *
 * # Clear all backups for current branch
 * pando branch backup --clear --all
 */
export default class BranchBackup extends Command {
  static description = 'Create or clear timestamped backups of a branch'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> -m "Before risky refactor"',
    '<%= config.bin %> <%= command.id %> --branch main',
    '<%= config.bin %> <%= command.id %> --branch feature/auth -m "Pre-merge backup" --json',
    '<%= config.bin %> <%= command.id %> --clear',
    '<%= config.bin %> <%= command.id %> --clear --all',
    '<%= config.bin %> <%= command.id %> --clear --all --force',
    '<%= config.bin %> <%= command.id %> --clear --target backup/main/20250117-153045 --json',
  ]

  static flags = {
    branch: Flags.string({
      char: 'b',
      description: 'Source branch to backup (default: current branch)',
      required: false,
    }),
    message: Flags.string({
      char: 'm',
      description: 'Optional message to store with the backup',
      required: false,
    }),
    json: jsonFlag,
    clear: Flags.boolean({
      description: 'Clear (delete) backup branches instead of creating a new backup',
      default: false,
    }),
    target: Flags.string({
      char: 't',
      description: 'Specific backup branch to delete (requires --clear and --json)',
      dependsOn: ['clear'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Delete all backups for the current branch (requires --clear)',
      default: false,
      dependsOn: ['clear'],
    }),
    force: forceFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(BranchBackup)

    if (flags.clear) {
      await this.runClear(flags)
    } else {
      await this.runBackup(flags)
    }
  }

  /**
   * Create a new backup branch
   */
  private async runBackup(flags: {
    branch?: string
    message?: string
    json: boolean
  }): Promise<void> {
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

    // Step 2: Determine source branch
    let sourceBranch: string
    if (flags.branch) {
      sourceBranch = flags.branch
    } else {
      try {
        sourceBranch = await gitHelper.getCurrentBranch()
      } catch {
        ErrorHelper.validation(
          this,
          'Cannot determine current branch (HEAD is detached).\n\n' +
            'Options:\n' +
            '  • Use --branch <name> to specify the branch to backup\n' +
            '  • Checkout a branch first: git checkout <branch>',
          flags.json
        )
        return
      }
    }

    // Step 3: Validate source branch exists
    const branchExists = await gitHelper.branchExists(sourceBranch)
    if (!branchExists) {
      ErrorHelper.validation(
        this,
        `Branch '${sourceBranch}' does not exist.\n\n` +
          'Use --branch to specify an existing branch, or create it first.',
        flags.json
      )
      return
    }

    // Step 4: Generate backup branch name with current timestamp
    const now = new Date()
    const backupName = generateBackupBranchName(sourceBranch, now)

    // Step 5: Get the commit hash for the source branch
    let sourceCommit: string
    try {
      sourceCommit = await gitHelper.getCommitHash(sourceBranch)
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        `Failed to get commit for branch '${sourceBranch}'`,
        flags.json
      )
      return
    }

    // Step 6: Create the backup branch at the source commit
    try {
      await gitHelper.createBranch(backupName, sourceCommit)
    } catch (error) {
      ErrorHelper.operation(
        this,
        error as Error,
        `Failed to create backup branch '${backupName}'`,
        flags.json
      )
      return
    }

    // Step 7: Store optional message as branch description
    let messageWarning: string | undefined
    if (flags.message) {
      try {
        await gitHelper.setBranchDescription(backupName, flags.message)
      } catch (error) {
        // Warn but don't fail - the backup was created successfully.
        // In --json mode, keep stdout as a single JSON document.
        messageWarning = `Failed to store backup message: ${(error as Error).message}`
      }
    }

    // Step 8: Format and output result
    const result: BackupCreateResult = {
      name: backupName,
      sourceBranch,
      commit: sourceCommit,
      timestamp: toIsoSeconds(now),
      ...(flags.message && { message: flags.message }),
    }

    await this.formatBackupOutput(flags.json, result, messageWarning)
  }

  /**
   * Clear (delete) backup branches for the current branch
   */
  private async runClear(flags: {
    target?: string
    all: boolean
    force: boolean
    json: boolean
  }): Promise<void> {
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

    // Step 2: Get current branch (--clear always operates on current branch)
    let sourceBranch: string
    try {
      sourceBranch = await gitHelper.getCurrentBranch()
    } catch {
      ErrorHelper.validation(
        this,
        'Cannot determine current branch (HEAD is detached).\n\n' +
          'Please checkout a branch first: git checkout <branch>',
        flags.json
      )
      return
    }

    // Step 3: List backups for current branch
    const backups = await gitHelper.listBackupBranches(sourceBranch)
    if (backups.length === 0) {
      ErrorHelper.validation(
        this,
        `No backups found for branch '${sourceBranch}'.\n\nNothing to clear.`,
        flags.json
      )
      return
    }

    // Step 4: Determine which backups to delete based on flags
    let backupsToDelete: BackupBranchInfo[]

    if (flags.json) {
      // JSON mode requires explicit specification
      if (!flags.target && !flags.all) {
        ErrorHelper.validation(
          this,
          'JSON mode requires either --target <name> or --all.\n\n' +
            `Available backups for '${sourceBranch}':\n` +
            backups.map((b) => `  • ${b.name}`).join('\n'),
          flags.json
        )
        return
      }

      if (flags.target) {
        // Single backup deletion
        const found = backups.find((b) => b.name === flags.target)
        if (!found) {
          ErrorHelper.validation(
            this,
            `Backup '${flags.target}' not found.\n\n` +
              `Available backups for '${sourceBranch}':\n` +
              backups.map((b) => `  • ${b.name}`).join('\n'),
            flags.json
          )
          return
        }
        backupsToDelete = [found]
      } else {
        // --all: delete all backups
        backupsToDelete = backups
      }
    } else if (flags.all) {
      // Non-JSON with --all: delete all with confirmation
      backupsToDelete = backups

      if (!flags.force) {
        const confirmed = await this.confirmDeletion(backupsToDelete, sourceBranch)
        if (!confirmed) {
          this.log('Clear cancelled.')
          return
        }
      }
    } else {
      // Interactive mode: checkbox multi-select
      backupsToDelete = await this.selectBackupsToDelete(backups)

      if (backupsToDelete.length === 0) {
        this.log('No backups selected.')
        return
      }

      if (!flags.force) {
        const confirmed = await this.confirmDeletion(backupsToDelete, sourceBranch)
        if (!confirmed) {
          this.log('Clear cancelled.')
          return
        }
      }
    }

    // Step 5: Execute deletion
    const result = await this.executeClear(gitHelper, backupsToDelete, sourceBranch)

    // Step 6: Format and output result
    await this.formatClearOutput(flags.json, result)
  }

  /**
   * Select backups to delete interactively using checkbox multi-select
   */
  private async selectBackupsToDelete(backups: BackupBranchInfo[]): Promise<BackupBranchInfo[]> {
    const { checkbox } = await import('@inquirer/prompts')

    const choices = backups.map((backup) => {
      const timestampDate = parseBackupTimestamp(backup.name.split('/').pop() || '')
      const relativeTime = timestampDate ? formatRelativeTime(timestampDate) : ''
      const messageHint = backup.message ? ` - ${backup.message}` : ''

      return {
        name: `${backup.name}${relativeTime ? ` (${relativeTime})` : ''}${messageHint}`,
        value: backup,
      }
    })

    return checkbox({
      message: 'Select backups to delete (spacebar to select, enter to confirm):',
      choices,
    })
  }

  /**
   * Confirm deletion of selected backups
   */
  private async confirmDeletion(
    backups: BackupBranchInfo[],
    sourceBranch: string
  ): Promise<boolean> {
    const { confirm } = await import('@inquirer/prompts')
    const chalk = (await import('chalk')).default

    const lines: string[] = []
    lines.push('')
    lines.push(
      chalk.yellow(
        `⚠ Warning: This will permanently delete ${backups.length} backup(s) for '${sourceBranch}'.`
      )
    )
    lines.push('')
    lines.push('Backups to delete:')

    for (const backup of backups) {
      const timestampDate = parseBackupTimestamp(backup.name.split('/').pop() || '')
      const relativeTime = timestampDate ? ` (${formatRelativeTime(timestampDate)})` : ''
      lines.push(chalk.cyan(`  - ${backup.name}${relativeTime}`))
    }

    lines.push('')
    this.log(lines.join('\n'))

    return confirm({
      message: 'Are you sure you want to delete these backups?',
      default: false,
    })
  }

  /**
   * Execute the clear operation to delete backup branches
   */
  private async executeClear(
    gitHelper: GitHelper,
    backupsToDelete: BackupBranchInfo[],
    sourceBranch: string
  ): Promise<BackupClearResult> {
    const deleted: BackupDeleteResult[] = []

    for (const backup of backupsToDelete) {
      try {
        // Delete the branch with force flag (in case not fully merged)
        await gitHelper.deleteBranch(backup.name, true)

        // Also clean up the branch description from git config
        try {
          await gitHelper.deleteBranchDescription(backup.name)
        } catch {
          // Ignore - description may not exist
        }

        deleted.push({ name: backup.name, deleted: true })
      } catch (error) {
        deleted.push({
          name: backup.name,
          deleted: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const deletedCount = deleted.filter((d) => d.deleted).length
    const failedCount = deleted.filter((d) => !d.deleted).length

    return {
      sourceBranch,
      totalBackups: backupsToDelete.length,
      deletedCount,
      failedCount,
      deleted,
    }
  }

  /**
   * Format and output the clear result
   */
  private async formatClearOutput(isJson: boolean, result: BackupClearResult): Promise<void> {
    if (isJson) {
      const hasFailures = result.failedCount > 0
      const output: Record<string, unknown> = {
        status: hasFailures ? 'warning' : 'success',
        clear: result,
      }
      if (hasFailures) {
        output.warning = `${result.failedCount} backup(s) failed to delete`
      }
      this.log(JSON.stringify(output, null, 2))
    } else {
      const chalk = (await import('chalk')).default
      const output: string[] = []

      if (result.deletedCount > 0) {
        output.push(
          chalk.green(`✓ Deleted ${result.deletedCount} backup(s) for '${result.sourceBranch}'`)
        )
        for (const item of result.deleted.filter((d) => d.deleted)) {
          output.push(chalk.gray(`  - ${item.name}`))
        }
      }

      if (result.failedCount > 0) {
        if (result.deletedCount > 0) {
          output.push('')
        }
        output.push(chalk.red(`✗ Failed to delete ${result.failedCount} backup(s):`))
        for (const item of result.deleted.filter((d) => !d.deleted)) {
          output.push(chalk.red(`  - ${item.name}: ${item.error}`))
        }
      }

      this.log(output.join('\n'))
    }
  }

  /**
   * Format and output the backup result
   */
  private async formatBackupOutput(
    isJson: boolean,
    result: BackupCreateResult,
    warning?: string
  ): Promise<void> {
    if (isJson) {
      const output: Record<string, unknown> = {
        status: warning ? 'warning' : 'success',
        backup: result,
      }
      if (warning) {
        output.warning = warning
      }
      this.log(JSON.stringify(output, null, 2))
    } else {
      const chalk = (await import('chalk')).default
      const output: string[] = []

      output.push(chalk.green(`✓ Backup created: ${result.name}`))
      output.push(chalk.gray(`  Source branch: ${result.sourceBranch}`))
      output.push(chalk.gray(`  Commit: ${result.commit.substring(0, 7)}`))
      if (result.message) {
        output.push(chalk.gray(`  Message: ${result.message}`))
      }
      output.push('')
      output.push(chalk.cyan(`To restore: pando branch restore --backup ${result.name}`))

      if (warning) {
        output.push('')
        output.push(chalk.yellow(`⚠ ${warning}`))
      }

      this.log(output.join('\n'))
    }
  }
}
