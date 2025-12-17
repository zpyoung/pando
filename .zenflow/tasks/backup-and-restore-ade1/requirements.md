# Product Requirements Document: Branch Backup and Restore

## Overview

Add `pando branch backup` and `pando branch restore` commands to enable users to create point-in-time snapshots of branches and restore from them when needed.

## Problem Statement

When working on feature branches, developers sometimes need to experiment with risky changes (rebases, squashes, major refactors) or want a safety net before destructive operations. Currently, users must manually create backup branches, remember naming conventions, and handle restoration themselves.

## Goals

1. **Simple backup creation**: One command to create a timestamped backup of any branch
2. **Easy restoration**: Interactive selection from available backups with clear timestamps
3. **Consistency**: Follow existing pando command patterns (flags, JSON output, error handling)
4. **Safety**: Prevent accidental data loss with clear warnings and confirmations

## User Stories

### US-1: Create a Backup
**As a** developer working on a feature branch
**I want to** create a backup of my current branch state
**So that** I can safely experiment knowing I can restore if needed

### US-2: Restore from a Backup
**As a** developer who made unwanted changes
**I want to** restore my branch from a previous backup
**So that** I can recover my previous work state

### US-3: View Available Backups
**As a** developer
**I want to** see all available backups for a branch
**So that** I can decide which point-in-time to restore to

### US-4: Clean Up Old Backups
**As a** developer
**I want to** delete old backups I no longer need
**So that** I can keep my branch list clean

---

## Functional Requirements

### FR-1: `pando branch backup` Command

**Description**: Create a backup branch from the current or specified branch.

**Input Options**:
| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--branch` | `-b` | Source branch to backup | Current branch |
| `--message` | `-m` | Optional description for backup | None |
| `--json` | `-j` | Output in JSON format | false |

**Behavior**:
1. Determine the source branch (from flag or current branch)
2. Generate backup branch name: `backup/<source-branch>/<timestamp>`
   - Timestamp format: `YYYYMMDD-HHmmss` (e.g., `backup/feature-x/20251217-143022`)
3. Create the backup branch pointing to the same commit as the source
4. Store optional message in branch description (using `git branch --edit-description`)
5. Output success with backup branch name and commit hash

**Output (Human)**:
```
✓ Created backup: backup/feature-x/20251217-143022
  Source: feature-x (abc1234)
  Message: Before major refactor
```

**Output (JSON)**:
```json
{
  "status": "success",
  "backup": {
    "name": "backup/feature-x/20251217-143022",
    "sourceBranch": "feature-x",
    "commit": "abc1234567890",
    "message": "Before major refactor",
    "timestamp": "2025-12-17T14:30:22Z"
  }
}
```

**Error Cases**:
- Not in a git repository → validation error
- Source branch doesn't exist → validation error
- HEAD is detached (no branch specified) → validation error with guidance

---

### FR-2: `pando branch restore` Command

**Description**: Restore a branch from one of its backups.

**Input Options**:
| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--branch` | `-b` | Target branch to restore | Current branch |
| `--backup` | | Specific backup to restore from | Interactive selection |
| `--force` | `-f` | Skip confirmation prompt | false |
| `--delete-backup` | `-d` | Delete the backup after successful restore | false |
| `--json` | `-j` | Output in JSON format | false |

**Behavior**:
1. Determine the target branch (from flag or current branch)
2. Find all backups for the branch (branches matching `backup/<branch-name>/*`)
3. If `--backup` flag provided, use that; otherwise show interactive selection
4. Display backup details (timestamp, commit, message) for confirmation
5. Reset the target branch to point to the backup's commit
6. Optionally delete the backup branch if `--delete-backup` specified
7. Output success with restore details

**Interactive Selection** (non-JSON mode without `--backup`):
```
? Select a backup to restore (feature-x):
❯ backup/feature-x/20251217-143022 (2 hours ago) - Before major refactor
  backup/feature-x/20251217-102015 (6 hours ago) - Initial implementation
  backup/feature-x/20251216-173045 (yesterday) - <no message>
```

**Confirmation Prompt** (unless `--force`):
```
⚠ This will reset 'feature-x' to commit abc1234
  Current HEAD: def5678 (3 commits will be unreachable)

? Proceed with restore? (y/N)
```

**Output (Human)**:
```
✓ Restored feature-x from backup/feature-x/20251217-143022
  Previous HEAD: def5678 → New HEAD: abc1234
  Backup retained (use --delete-backup to remove after restore)
```

**Output (JSON)**:
```json
{
  "status": "success",
  "restore": {
    "branch": "feature-x",
    "backup": "backup/feature-x/20251217-143022",
    "previousCommit": "def5678901234",
    "newCommit": "abc1234567890",
    "backupDeleted": false
  }
}
```

**Error Cases**:
- Not in a git repository → validation error
- Target branch doesn't exist → validation error
- No backups found for branch → validation error with helpful message
- Specified backup doesn't exist → validation error
- Branch has uncommitted changes → validation error with guidance
- Target branch is currently checked out in a worktree → operation error with worktree path

---

### FR-3: List Backups (via `pando branch backup --list`)

**Description**: List all backups for a branch.

**Input Options**:
| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--list` | `-l` | List backups instead of creating | false |
| `--branch` | `-b` | Branch to list backups for | Current branch |
| `--all` | `-a` | List backups for all branches | false |
| `--json` | `-j` | Output in JSON format | false |

**Output (Human)**:
```
Backups for feature-x:
  backup/feature-x/20251217-143022  abc1234  2 hours ago   Before major refactor
  backup/feature-x/20251217-102015  def5678  6 hours ago   Initial implementation
  backup/feature-x/20251216-173045  ghi9012  yesterday     <no message>
```

**Output (JSON)**:
```json
{
  "status": "success",
  "branch": "feature-x",
  "backups": [
    {
      "name": "backup/feature-x/20251217-143022",
      "commit": "abc1234567890",
      "timestamp": "2025-12-17T14:30:22Z",
      "message": "Before major refactor",
      "age": "2 hours ago"
    }
  ]
}
```

---

### FR-4: Delete Backups (via `pando branch backup --delete`)

**Description**: Delete one or more backup branches.

**Input Options**:
| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--delete` | | Delete specified backup(s) | false |
| `--branch` | `-b` | Branch whose backups to consider | Current branch |
| `--all` | `-a` | Delete all backups for the branch | false |
| `--force` | `-f` | Skip confirmation | false |
| `--json` | `-j` | Output in JSON format | false |

**Behavior**:
1. If `--all`, delete all backups for the specified branch
2. If backup name(s) provided as arguments, delete those
3. Otherwise, show interactive multi-select for deletion
4. Confirm before deletion (unless `--force`)

---

## Non-Functional Requirements

### NFR-1: Consistency
- Follow existing pando command patterns from `add.ts`, `remove.ts`, `list.ts`
- Use ErrorHelper for all error handling
- Support `--json` flag for all operations
- Use chalk for colored output, ora for spinners

### NFR-2: Safety
- Never delete data without explicit user consent (confirmation prompts)
- Warn when restoring would make commits unreachable
- Validate branch state before destructive operations

### NFR-3: Performance
- Listing backups should be fast (< 1s for reasonable numbers)
- Creating backups should be near-instant (branch creation only)

### NFR-4: Usability
- Timestamps should be human-readable in interactive mode
- Backup messages should support spaces and special characters
- Tab completion friendly branch names (no spaces in backup names)

---

## Technical Decisions

### Backup Naming Convention
Format: `backup/<source-branch>/<timestamp>`
- **Pros**: Hierarchical, easily filtered, sortable by date
- **Timestamp**: ISO-like but filesystem-safe: `YYYYMMDD-HHmmss`

### Storage Mechanism
Use git branches (not tags) because:
- Branches are local by default (won't pollute remote)
- Easy to delete without affecting other users
- Works seamlessly with existing git workflows
- Can store description via `git branch --edit-description`

### Restore Implementation
Use `git branch -f <branch> <commit>` to reset branch pointer:
- Doesn't require checkout
- Works even if branch is checked out elsewhere (worktree scenario)
- Preserves reflog for additional safety

---

## Out of Scope

1. **Remote backup push**: Backups are local-only. Users can push manually if needed.
2. **Automatic backup scheduling**: Users create backups explicitly.
3. **Backup of uncommitted changes**: Only committed state is backed up (stash is separate).
4. **Cross-repository backup**: Only within the same repository.
5. **Backup rotation/retention policies**: Users manage cleanup manually.

---

## Success Criteria

1. Users can create backups in < 2 seconds
2. Users can restore to any backup in < 5 seconds
3. All operations work correctly with `--json` flag
4. Error messages guide users to resolution
5. No data loss without explicit user consent
6. Commands feel native alongside existing pando commands
