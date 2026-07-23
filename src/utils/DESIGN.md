# Utilities Design

## Purpose

This module provides core utility functions for git operations, file operations (rsync/symlink), and worktree setup orchestration. These utilities form the business logic layer between commands and external tools.

## Files Overview

- **git.ts** - Git operations wrapper using simple-git
- **fileOps.ts** - Rsync and symlink operations with transaction support; strips transport/exec-class rsync flags as a security denylist
- **worktreeSetup.ts** - Post-worktree-creation orchestrator (rsync + symlink, transactional). Also powers `pando adopt` via **adopt mode** (`SetupOptions.adopt`): non-destructive rollback, skip-not-clobber symlink conflicts, dirt-tolerant clean-tree check, and a `dryRun` plan (`SetupPlan`)
- **postCommands.ts** - Run configured post-command shell scripts and shape their results (`PostCommandResult`, `PostCommandError`)
- **postCommandRunner.ts** - Trust-gated post-command execution shared by `add` and `adopt` (`runTrustedPostCommands`): normalize → config-trust gate → run, with a fallback config key
- **setupFlags.ts** - Shared rsync/symlink/ports flag-override logic applied by both `add` and `adopt` (`applySetupFlagOverrides`)
- **configTrust.ts** - direnv-style trust store gating config-file post-commands (content-hash pinning, pure decision function)
- **branch-backups.ts** - Timestamp formatting and backup branch name parsing/formatting for backup/restore
- **commandDetails.ts** - Build the `--details` payload for `add` (rsync totals, sampled symlink paths)
- **rsyncProgress.ts** - Typed interfaces for real-time rsync progress reporting
- **common-flags.ts** - Shared CLI flag definitions (`json`, `force`, `path`) for cross-command consistency
- **errors.ts** - `ErrorHelper` for consistent validation/operation/unexpected/warn output (human + JSON)
- **validation.ts** - Branch-name validation against the core `git check-ref-format` rules

## Key Design Decisions

### Transaction-Based File Operations
**Chosen**: All file operations tracked in transactions with rollback support
**Rationale**:
- Prevents partial failures leaving broken worktrees
- Users never left in bad state
- Clear error recovery path
- Professional-grade reliability

**Implementation**:
```typescript
transaction.record(OperationType.CREATE_SYMLINK, path)
// ... do operation ...
// On error:
const result = await transaction.rollback()
// result.checkpoints preserves data for post-rollback cleanup (e.g., worktree path)
// result.rolledBackOperations shows what was undone
```

**Note**: `rollback()` returns a `RollbackResult` with preserved checkpoints because internal state is cleared during rollback. This prevents temporal coupling bugs where checkpoint data is needed after rollback completes.

### Rsync for File Copying
**Chosen**: Use rsync instead of native Node.js file copying
**Rationale**:
- Rsync is standard on Unix systems
- Efficient for large file trees
- Respects permissions and timestamps
- Battle-tested and reliable
- Progress streaming support

**Trade-off**: Requires rsync to be installed

### Untracked-Only Sync (Clean-Tree Invariant)
**Chosen**: By default, rsync transfers only files that are gitignored in the
source worktree (`git ls-files --others --ignored --exclude-standard`), passed
via `--files-from`/`--from0`.
**Rationale**:
- Tracked files come from the target's own `git checkout`; copying them from
  the source clobbers the target whenever the branches differ (the "dirty
  worktree" bug)
- Gitignored artifacts (.venv, node_modules, caches) are exactly the
  expensive-to-rebuild files worth carrying over, and they never appear in
  `git status`
- Non-ignored untracked files (WIP) are deliberately left behind so the new
  worktree starts clean
- Safe across commits, so existing-branch worktrees still get artifact sync

The exclude patterns are ALSO applied to the file list in JS
(`RsyncHelper.filterExcludedPaths`, micromatch-based) because rsync
implementations disagree on whether filter rules apply to `--files-from`
entries (openrsync does not apply directory excludes to listed files).

`rsync.onlyUntracked = false` restores the legacy full-tree mirror, which only
runs when source and target are on the same commit.

After setup, the orchestrator verifies the invariant: `git status` in the new
worktree must be empty aside from the symlinks pando itself created
(`SetupResult.cleanTree`, surfaced as `setup.cleanTree` in `pando add --json`).

### Skip-Worktree for Tracked Symlinks
**Chosen**: `GitHelper.setSkipWorktree` intersects requested paths with
`git ls-files` before marking, expanding directories to their tracked entries.
**Rationale**:
- `git update-index --skip-worktree` dies on any path not in the index, so a
  single untracked path (a gitignored `.env` symlink) used to abort the whole
  batch and leave every tracked symlink visible as deleted/modified
- Untracked/ignored symlinks never show in status and need no marking
- Directories cannot be marked; their tracked contents can
- Failed batches retry per file so one bad path cannot hide the rest

`symlink.allowTracked = false` (strict mode) skips tracked patterns entirely
with a warning instead of symlinking + hiding them.

### Separate Concerns
**Chosen**: Separate helpers for rsync, symlink, and orchestration
**Rationale**:
- Single responsibility principle
- Easier to test independently
- Can be used separately if needed
- Clear dependencies

## Patterns Used

### Helper Factory Pattern
Create helpers with dependencies injected:
```typescript
const transaction = new FileOperationTransaction()
const rsyncHelper = createRsyncHelper(transaction)
const symlinkHelper = createSymlinkHelper(transaction)
```

### Orchestrator Pattern
High-level coordinator that uses multiple helpers:
```typescript
class WorktreeSetupOrchestrator {
  constructor(gitHelper, config) {
    this.rsyncHelper = createRsyncHelper(transaction)
    this.symlinkHelper = createSymlinkHelper(transaction)
  }

  async setupNewWorktree(path, options) {
    // Coordinate all steps
  }
}
```

### Progress Callback Pattern
Report progress without coupling to UI:
```typescript
await orchestrator.setupNewWorktree(path, {
  onProgress: (phase, message) => {
    spinner.text = message
  }
})
```

### Custom Error Classes
Specific errors for better handling:
```typescript
throw new RsyncNotInstalledError()
throw new SymlinkConflictError(message, conflicts)
throw new SetupError(message, result, cause)
```

## Dependencies

### External
- `simple-git` - Git operations
- `globby` - Glob pattern matching
- `fs-extra` - Enhanced file operations
- `child_process` - For rsync execution

### Internal
- `../config/schema` - Configuration types

## Usage Examples

### Git Operations
```typescript
import { createGitHelper } from './utils/git'

const git = createGitHelper()

// Check if git repo
const isRepo = await git.isRepository()

// Get repository root
const root = await git.getRepositoryRoot()

// Get main worktree path
const mainPath = await git.getMainWorktreePath()

// Add worktree
const info = await git.addWorktree('../feature', {
  branch: 'feature-x',
  skipPostCreate: true
})
```

### File Operations
```typescript
import {
  FileOperationTransaction,
  createRsyncHelper,
  createSymlinkHelper
} from './utils/fileOps'

const transaction = new FileOperationTransaction()
const rsync = createRsyncHelper(transaction)
const symlink = createSymlinkHelper(transaction)

try {
  // Rsync files
  const rsyncResult = await rsync.rsync(
    '/source',
    '/dest',
    config.rsync,
    { excludePatterns: ['*.log'] }
  )

  // Create symlinks
  const symlinkResult = await symlink.createSymlinks(
    '/source',
    '/dest',
    config.symlink
  )
} catch (error) {
  // Rollback on error - returns preserved checkpoints and rollback status
  const result = await transaction.rollback()
  console.log(`Rolled back ${result.rolledBackOperations.length} operations`)
  if (result.failedRollbacks.length > 0) {
    console.warn('Some rollback operations failed:', result.failedRollbacks)
  }
  throw error
}
```

### Worktree Setup
```typescript
import { createWorktreeSetupOrchestrator } from './utils/worktreeSetup'

const orchestrator = createWorktreeSetupOrchestrator(gitHelper, config)

const result = await orchestrator.setupNewWorktree(
  '/path/to/worktree',
  {
    rsyncOverride: { exclude: ['tmp/'] },
    onProgress: (phase, message) => {
      console.log(`[${phase}] ${message}`)
    }
  }
)

console.log(`Files synced: ${result.rsyncResult?.filesTransferred}`)
console.log(`Symlinks created: ${result.symlinkResult?.created}`)
```

## Testing Approach

### Unit Tests
- Mock simple-git for git operations
- Mock child_process for rsync
- Mock fs for file operations
- Test transaction rollback logic
- Test error handling

### Integration Tests
- Use temporary git repositories
- Test with real rsync (if available)
- Test real symlink creation
- Test full orchestration workflow
- Test rollback with actual operations

## Error Handling

### Rsync Not Installed
```typescript
if (!(await rsyncHelper.isInstalled())) {
  throw new RsyncNotInstalledError()
}
```

Command layer catches and shows:
```
Error: rsync is not installed

Pando uses rsync to copy files between worktrees.
Please install rsync:
  - macOS: brew install rsync
  - Ubuntu/Debian: apt install rsync
  - Fedora: dnf install rsync

Or skip rsync: pando add --skip-rsync
```

### Symlink Conflicts
```typescript
const conflicts = await symlinkHelper.detectConflicts(links)
if (conflicts.length > 0) {
  throw new SymlinkConflictError('Conflicts detected', conflicts)
}
```

Shows which files conflict and why.

### Transaction Rollback
On any error during setup:
1. Log the error
2. Execute transaction.rollback()
3. Remove worktree completely
4. Report what was rolled back
5. Suggest next steps

## Future Considerations

### Planned Features
1. **Incremental Rsync** - Only sync changed files
2. **Parallel Operations** - Rsync and symlink in parallel when safe
3. **Dry Run Mode** - Preview what would be done
4. **Progress Estimation** - Better progress for large rsyncs
5. **Conflict Resolution** - Interactive prompts for conflicts

### Alternative Copy Methods
- Native Node.js copying (fallback if no rsync)
- Hard links instead of copies (save space)
- Copy-on-write for supported filesystems

### Enhanced Transaction System
- Nested transactions
- Savepoints for partial rollback
- Transaction log export
- Replay transactions

## Related Documentation

- [Root ARCHITECTURE.md](../../ARCHITECTURE.md) - System architecture
- [Commands](../commands/) - Command implementations that use these utilities
- [Config DESIGN.md](../config/DESIGN.md) - Configuration system
