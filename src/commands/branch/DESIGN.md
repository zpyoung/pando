# Branch Commands Design

## Purpose

Branch management commands for creating and restoring timestamped backups. These commands provide a safety net for branch operations by allowing users to snapshot branch state before risky operations and restore if needed.

## Files in This Module

- `backup.ts`: Create or clear timestamped backup branches
- `restore.ts`: Restore a branch from a backup

## Implementation Approach

- **Backup**: Creates backup branches with naming convention `backup/<sourceBranch>/<timestamp>`
  - Timestamp format: `YYYYMMDD-HHmmss` (UTC)
  - Optional messages stored in git config as branch descriptions
  - `--clear` mode for deleting backups:
    - Interactive checkbox selection (default)
    - `--all` for batch deletion
    - `--target <name>` for specific backup (JSON mode)
    - Confirmation prompt (skippable with `--force`)
  - Cleans up git config entries when deleting backups

- **Restore**: Resets target branch to backup's commit
  - Interactive backup selection or explicit `--backup` flag
  - Safety checks: uncommitted changes, worktree conflicts
  - Shows lost/gained commits tree before confirmation
  - Optional `--delete-backup` to clean up after restore
  - JSON mode requires explicit `--backup` flag

## Key Interfaces

```typescript
// backup.ts
interface BackupCreateResult {
  name: string           // Full backup branch name
  sourceBranch: string   // Source branch that was backed up
  commit: string         // Commit SHA
  message?: string       // Optional user message
  timestamp: string      // ISO timestamp
}

interface BackupClearResult {
  sourceBranch: string   // Branch whose backups were cleared
  totalBackups: number   // Count targeted for deletion
  deletedCount: number   // Successfully deleted
  failedCount: number    // Failed to delete
  deleted: BackupDeleteResult[]
}

// restore.ts
interface RestoreResult {
  branch: string         // Branch that was restored
  backup: string         // Backup branch used
  previousCommit: string // Commit before restore
  newCommit: string      // Commit after restore
  backupDeleted: boolean // Whether backup was removed
  lostCommits?: {...}    // Commits that became unreachable
  gainedCommits?: {...}  // Commits restored from backup
}
```

## Dependencies

- `@oclif/core`: Command framework
- `@inquirer/prompts`: Interactive selection (select, checkbox, confirm)
- `../../utils/git.js`: GitHelper for git operations
- `../../utils/branch-backups.js`: Timestamp parsing/formatting, commit tree display
- `../../utils/common-flags.js`: Shared flag definitions (json, force)
- `../../utils/errors.js`: ErrorHelper for consistent error handling

## Usage Examples

```bash
# Create backup of current branch
pando branch backup
pando branch backup -m "Before risky refactor"

# Create backup of specific branch
pando branch backup --branch main

# Clear backups interactively
pando branch backup --clear

# Clear all backups for current branch
pando branch backup --clear --all
pando branch backup --clear --all --force

# Clear specific backup (JSON mode)
pando branch backup --clear --target backup/main/20250117-153045 --json

# Restore interactively
pando branch restore

# Restore with explicit backup
pando branch restore --backup backup/main/20250117-153045

# Force restore and delete backup
pando branch restore --backup backup/main/20250117-153045 --force --delete-backup
```

## Testing Approach

- **E2E Tests**: Full integration tests with Docker containers
  - `test/e2e/commands/branch-backup.e2e.test.ts`: Backup creation and clearing
  - `test/e2e/commands/branch-restore.e2e.test.ts`: Restore operations
- **Unit Tests**: Utility function tests in `test/utils/branch-backups.test.ts`

## Future Improvements

- Backup retention policies (auto-cleanup old backups by age or count)
- `pando branch backup list` command for viewing all backups across branches
- Backup annotations with more metadata (author, reason)
- Remote backup sync (push/pull backup refs)
