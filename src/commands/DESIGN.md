# Commands Design

## Purpose

This directory contains all CLI command implementations for Pando. Each command is a self-contained class that handles user interaction, validation, and orchestration of business logic from the utilities layer.

## Files Overview

| File | Description |
|------|-------------|
| `add.ts` | Create new git worktrees with optional rsync/symlink setup and post-commands |
| `adopt.ts` | Take over an externally-created worktree: run pando setup (adopt-safe mode) without creating or clobbering |
| `list.ts` | List all git worktrees in the repository |
| `remove.ts` | Remove worktrees with optional branch deletion (guards the main worktree) |
| `clean.ts` | Detect and remove stale worktrees (merged, gone upstream, prunable) |
| `health.ts` | Show health status of all worktrees |
| `symlink.ts` | Move file to main worktree and create symlink |
| `branch/backup.ts` | Create or clear timestamped backup branches |
| `branch/restore.ts` | Restore a branch from a backup branch |
| `config/` | Configuration subcommands (init, show) |

## Command Architecture

### Base Pattern

All commands follow the oclif Command pattern:

```typescript
import { Command, Flags, Args } from '@oclif/core'

export default class CommandName extends Command {
  static description = 'Brief description'
  static examples = ['<%= config.bin %> <%= command.id %> --flag value']

  static flags = {
    json: Flags.boolean({ char: 'j', description: 'Output in JSON format' }),
    // other flags...
  }

  static args = {
    // optional arguments...
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CommandName)
    // Implementation
  }
}
```

### Key Design Decisions

1. **JSON Output**: All commands support `--json` flag for machine-readable output
2. **ErrorHelper Pattern**: All errors use `ErrorHelper` from `../utils/errors.js` for consistent error handling
3. **GitHelper Dependency**: Commands use `createGitHelper()` for git operations
4. **Lazy Loading**: Dynamic imports for UI libraries (ora, chalk) to reduce startup time

## Command Details

### add.ts

**Purpose**: Create new git worktrees with optional rsync/symlink setup

**Key Features**:
- Creates worktree with new branch (`-b`) or from commit (`-c`)
- Supports checkout of existing branches
- Automatic rebase of existing branches (configurable)
- Integrates with WorktreeSetupOrchestrator for rsync/symlink
- Uses configuration from `.pando.toml` and environment variables

**Flags**:
- `--path, -p`: Target path for worktree
- `--branch, -b`: Branch name
- `--commit, -c`: Base commit
- `--force, -f`: Force reset existing branch
- `--no-rebase`: Skip automatic rebase

### adopt.ts

**Purpose**: Take over a worktree pando did **not** create (raw `git worktree add`, another tool) and run pando's standard setup on it — the setup-only half of `add`, with safety rails for a worktree that may already hold real work.

**Key Features**:
- Resolves the target from a positional `[path]` or the cwd; rejects the main worktree and non-worktrees (`GitHelper.getWorktreeByPath`)
- Reuses `WorktreeSetupOrchestrator.setupNewWorktree` in **adopt mode** (`SetupOptions.adopt`): non-destructive rollback (never `git worktree remove`), skip-not-clobber symlink conflicts (`--replace-existing` to override), dirt-tolerant clean-tree check
- `--dry-run` returns a `SetupPlan` (symlink create/already-linked/conflict buckets + rsync file count/mode) and mutates nothing
- Reuses `setupLifecycleMetadata` with a long-lived-default `kindOverride`; records `sourceBranch = worktree.targetBranch`
- Shares the trust-gated post-command runner (`runTrustedPostCommands`) with `add`, using the `adopt` config key (falling back to `add`)
- Idempotent: re-adopting an already-managed worktree re-applies and reports `alreadyManaged`

**Flags**:
- `[path]`: Worktree to adopt (positional; defaults to cwd)
- `--dry-run`: Preview the plan without changes
- `--replace-existing`: Replace real files at symlink targets instead of skipping
- Lifecycle (`--ephemeral`/`--long-lived`/`--ttl`/`--owner`/`--ports`) and setup (`--skip-rsync`/`--skip-symlink`/`--rsync-*`/`--symlink`/`--absolute-symlinks`) flags mirror `add`

### list.ts

**Purpose**: Display all worktrees in the repository

**Key Features**:
- Shows path, branch, commit for each worktree
- Verbose mode shows additional details
- Marks prunable worktrees

**Flags**:
- `--verbose, -v`: Show detailed information
- `--json, -j`: JSON output

### health.ts

**Purpose**: Show health status of all worktrees

**Key Features**:
- Detects uncommitted changes with file count
- Identifies branches behind upstream
- Flags worktrees with gone remote branches
- Handles missing worktree directories gracefully
- Provides summary statistics

**Flags**:
- `--json, -j`: JSON output

**Health Status Types**:
- `clean`: No issues detected
- `uncommitted`: Has modified files (shows count)
- `behind`: Branch is N commits behind upstream
- `gone`: Remote tracking branch was deleted
- `detached`: Worktree is in detached-HEAD state (no branch)
- `error`: Cannot check status (directory missing, git error, or remote check failed)

**Example Output**:
```
Worktree Health Report
==================================================

🚨 Uncommitted changes:
  /worktree/feature-auth
    Branch: feature/auth
    2 files modified

✅ All good:
  /worktree/main
    Branch: main
```

**JSON Output**:
```json
{
  "worktrees": [
    {
      "path": "/worktree/feature-auth",
      "branch": "feature/auth",
      "status": "uncommitted",
      "message": "2 files modified",
      "details": {
        "uncommittedFiles": 2
      }
    }
  ],
  "summary": {
    "clean": 1,
    "detached": 0,
    "uncommitted": 1,
    "behind": 0,
    "gone": 0,
    "errors": 0
  }
}
```

### remove.ts

**Purpose**: Remove worktrees with optional branch cleanup

**Key Features**:
- Interactive multi-select when no path specified
- Optional local/remote branch deletion
- Force removal of dirty worktrees
- Safety checks for unmerged branches

**Flags**:
- `--path, -p`: Direct path to remove
- `--force, -f`: Force removal
- `--delete-branch, -d`: Delete branch (none/local/remote)

### symlink.ts

**Purpose**: Move file to main worktree and replace with symlink

**Key Features**:
- Moves file from current worktree to main worktree
- Creates relative symlink back to moved file
- Supports dry-run mode
- Transaction-based with rollback on failure

**Use Cases**:
- Environment files (`.env`)
- Lock files (`package-lock.json`)
- Shared configuration
- IDE settings

**Flags**:
- `--force, -f`: Overwrite existing file
- `--dry-run`: Preview operation
- `--json, -j`: JSON output

## Error Handling

Commands use the `ErrorHelper` utility for consistent error handling:

```typescript
import { ErrorHelper } from '../utils/errors.js'

// Validation errors (expected user errors)
ErrorHelper.validation(this, 'Message', flags.json)

// Operation errors (runtime failures)
ErrorHelper.operation(this, error, 'Context', flags.json)

// Warnings (non-fatal)
ErrorHelper.warn(this, 'Warning message', flags.json)
```

## UI Patterns

### Spinners

```typescript
const ora = !flags.json ? (await import('ora')).default : null
const spinner = ora ? ora() : null

if (spinner) spinner.start('Working...')
// ... operation ...
if (spinner) spinner.succeed('Done')
```

### Interactive Prompts

```typescript
import { checkbox, confirm } from '@inquirer/prompts'

if (!flags.json && !flags.path) {
  const selected = await checkbox({
    message: 'Select items:',
    choices: [{ name: 'Option A', value: 'a' }, { name: 'Option B', value: 'b' }],
  })
  const confirmed = await confirm({ message: 'Continue?', default: false })
}
```

## Testing

Command tests are in `test/commands/` and follow these patterns:

1. **Unit tests**: Test business logic and data structures
2. **Integration tests**: Test command behavior with mocked dependencies
3. **Filesystem tests**: Tests that interact with real filesystem use `/tmp`

See `test/commands/add.test.ts` and `test/commands/symlink.test.ts` for examples.

## Dependencies

- `@oclif/core`: CLI framework
- `chalk`: Terminal colors (lazy loaded)
- `ora`: Spinners (lazy loaded)
- `@inquirer/prompts`: Interactive prompts (checkbox, confirm, etc.)
- `../utils/git.js`: Git operations
- `../utils/fileOps.js`: File operations
- `../utils/errors.js`: Error handling
- `../config/loader.js`: Configuration loading

## Future Considerations

- Add `--fetch` flag to `health` command for git fetch --prune before checks
- Add `pando template` command for worktree templates
- Add `pando clone` for creating worktrees in new repositories
- Add fuzzy matching for branch names in `add` command
