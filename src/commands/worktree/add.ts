import { Command, Flags } from '@oclif/core'
import { createGitHelper } from '../../utils/git'
import { loadConfig } from '../../config/loader'
import { getEnvConfig } from '../../config/env'
import { createWorktreeSetupOrchestrator, SetupPhase } from '../../utils/worktreeSetup'

/**
 * Add a new git worktree
 *
 * Creates a new working tree linked to the current repository.
 * After creation, optionally rsyncs files and creates symlinks
 * based on configuration.
 */
export default class AddWorktree extends Command {
  static description = 'Add a new git worktree with optional rsync and symlink setup'

  static examples = [
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x',
    '<%= config.bin %> <%= command.id %> --path ../hotfix --branch hotfix --commit abc123',
    '<%= config.bin %> <%= command.id %> --path ../feature-y --branch feature-y --json',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --skip-rsync',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --symlink "package.json"',
  ]

  static flags = {
    // Basic worktree flags
    path: Flags.string({
      char: 'p',
      description: 'Path for the new worktree',
      required: true,
    }),
    branch: Flags.string({
      char: 'b',
      description: 'Branch to checkout or create',
      required: false,
    }),
    commit: Flags.string({
      char: 'c',
      description: 'Commit hash to base the new branch on',
      required: false,
    }),

    // Rsync control flags
    'skip-rsync': Flags.boolean({
      description: 'Skip rsync operation (ignore config)',
      default: false,
    }),
    'rsync-flags': Flags.string({
      description: 'Override rsync flags (comma-separated)',
      multiple: true,
    }),
    'rsync-exclude': Flags.string({
      description: 'Additional rsync exclude patterns',
      multiple: true,
    }),

    // Symlink control flags
    'skip-symlink': Flags.boolean({
      description: 'Skip symlink creation (ignore config)',
      default: false,
    }),
    symlink: Flags.string({
      description: 'Additional symlink patterns (overrides config)',
      multiple: true,
    }),
    'absolute-symlinks': Flags.boolean({
      description: 'Use absolute paths for symlinks instead of relative',
      default: false,
    }),

    // Output flags
    json: Flags.boolean({
      char: 'j',
      description: 'Output result in JSON format',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AddWorktree)

    // TODO: Phase 1 - Initialize and validate
    // 1. Create GitHelper instance
    // 2. Validate we're in a git repository
    // 3. Check if worktree path already exists
    // 4. Validate branch/commit if provided

    // TODO: Phase 2 - Load configuration
    // 1. Get git root directory
    // 2. Load config from all sources (loadConfig)
    // 3. Load environment variables (getEnvConfig)
    // 4. Merge flags into configuration (flags override config)
    //    - If --skip-rsync: set rsync.enabled = false
    //    - If --rsync-flags: override rsync.flags
    //    - If --rsync-exclude: add to rsync.exclude
    //    - If --skip-symlink: clear symlink.patterns
    //    - If --symlink: override symlink.patterns
    //    - If --absolute-symlinks: set symlink.relative = false

    // TODO: Phase 3 - Create worktree
    // 1. Use gitHelper.addWorktree() with skipPostCreate = true
    // 2. Handle git errors gracefully
    // 3. Log progress (use ora spinner if not --json)

    // TODO: Phase 4 - Post-creation setup
    // 1. Initialize WorktreeSetupOrchestrator with gitHelper and config
    // 2. Build SetupOptions from flags
    // 3. Execute setupNewWorktree() with progress callback
    // 4. Progress callback should:
    //    - Update ora spinner (if not --json)
    //    - Or log phase changes (if --json)
    // 5. Handle setup errors:
    //    - Catch SetupError
    //    - Check if rolledBack = true
    //    - Log what failed and what was rolled back
    //    - Provide helpful next steps

    // TODO: Phase 5 - Output formatting
    // If --json:
    //   {
    //     "success": true,
    //     "worktree": { "path": "...", "branch": "..." },
    //     "setup": {
    //       "rsync": { "filesTransferred": 1234, ... },
    //       "symlink": { "created": 3, ... }
    //     },
    //     "duration": 5432,
    //     "warnings": []
    //   }
    //
    // Otherwise:
    //   ✓ Worktree created at ../feature-x
    //   ✓ Files synced: 1,234 files (125 MB)
    //   ✓ Symlinks created: 3 files
    //   ⚠ Warnings: <list any warnings>
    //
    //   Ready to use: cd ../feature-x

    // TODO: Error handling
    // - RsyncNotInstalledError → friendly message with install instructions
    // - SymlinkConflictError → show conflicts, suggest resolution
    // - SetupError → show what failed, show rollback status, next steps
    // - Git errors → show git output, suggest fixes

    this.log('TODO: Implement worktree:add command with rsync/symlink support')
    this.log(`Path: ${flags.path}`)
    this.log(`Branch: ${flags.branch || '(none)'}`)
    this.log(`Commit: ${flags.commit || '(none)'}`)
    this.log(`Skip rsync: ${flags['skip-rsync']}`)
    this.log(`Skip symlink: ${flags['skip-symlink']}`)
    this.log(`Rsync flags: ${flags['rsync-flags']?.join(', ') || '(none)'}`)
    this.log(`Rsync exclude: ${flags['rsync-exclude']?.join(', ') || '(none)'}`)
    this.log(`Symlink patterns: ${flags.symlink?.join(', ') || '(from config)'}`)
    this.log(`Absolute symlinks: ${flags['absolute-symlinks']}`)
    this.log(`JSON output: ${flags.json}`)
  }
}
