import { Command, Flags } from '@oclif/core'
import { createGitHelper } from '../../utils/git.js'
import { generateBackupBranchName, toIsoSeconds } from '../../utils/branch-backups.js'
import { jsonFlag } from '../../utils/common-flags.js'
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
 * Create a timestamped backup branch of the current or specified branch
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
 */
export default class BranchBackup extends Command {
  static description = 'Create a timestamped backup of a branch'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> -m "Before risky refactor"',
    '<%= config.bin %> <%= command.id %> --branch main',
    '<%= config.bin %> <%= command.id %> --branch feature/auth -m "Pre-merge backup" --json',
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
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(BranchBackup)

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
    if (flags.message) {
      try {
        await gitHelper.setBranchDescription(backupName, flags.message)
      } catch (error) {
        // Warn but don't fail - the backup was created successfully
        ErrorHelper.warn(
          this,
          `Backup created but failed to store message: ${(error as Error).message}`,
          flags.json
        )
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

    await this.formatOutput(flags.json, result)
  }

  /**
   * Format and output the backup result
   */
  private async formatOutput(isJson: boolean, result: BackupCreateResult): Promise<void> {
    if (isJson) {
      this.log(
        JSON.stringify(
          {
            status: 'success',
            backup: result,
          },
          null,
          2
        )
      )
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

      this.log(output.join('\n'))
    }
  }
}
