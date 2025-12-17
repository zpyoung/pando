# Technical Specification: Branch Backup and Restore

## Technical Context

- **Language/Runtime**: TypeScript (ESM), Node.js >= 18
- **CLI Framework**: `@oclif/core` (topic separator is a space, so commands are invoked like `pando branch backup`)
- **Git**: `simple-git` wrapper via `src/utils/git.ts` (`GitHelper`)
- **Interactive prompts**: `@inquirer/prompts` (`select`, `confirm`, `checkbox`)
- **Output**: human-readable (chalk, optional ora spinners) and machine-readable via `--json`
- **Testing**: Vitest unit tests + existing E2E harness (`test/e2e/**`)

## Implementation Approach

### CLI Surface Area

Add a new oclif topic `branch` and two commands:

- `pando branch backup`
- `pando branch restore`

Optional (nice-to-have, from PRD): listing/deletion flows can be added later, but the core deliverable is “create backup” and “restore from backup”.

#### `pando branch backup`

**Purpose**: Create a point-in-time backup branch of a source branch (defaults to current branch).

**Flags**:
- `-b, --branch <name>`: Source branch to back up (default: current branch)
- `-m, --message <text>`: Optional description stored with the backup
- `-j, --json`: JSON output

**Behavior**:
1. Validate we’re inside a git repository (`GitHelper.isRepository()`).
2. Determine `sourceBranch`:
   - If `--branch` provided, use it.
   - Else use `GitHelper.getCurrentBranch()`; if detached HEAD, return a validation error with guidance to pass `--branch`.
3. Validate `sourceBranch` exists (`GitHelper.branchExists()`).
4. Generate backup branch name: `backup/<sourceBranch>/<timestamp>` where timestamp is UTC `YYYYMMDD-HHmmss`.
5. Create the backup branch at the same commit as `sourceBranch`.
6. If `--message` provided, store it as the branch description.
7. Print success output:
   - Human: checkmark + branch name + commit + message (if any)
   - JSON: matches PRD structure under `backup`.

**Message storage**:
- Use `git config branch.<backupBranch>.description <message>` to store branch descriptions non-interactively.
- Read via `git config --get branch.<branch>.description`.

#### `pando branch restore`

**Purpose**: Reset a target branch (default: current) to the commit of a selected backup.

**Flags**:
- `-b, --branch <name>`: Target branch to restore (default: current branch)
- `--backup <backupBranchName>`: Backup branch to restore from (if omitted, interactive select in non-JSON mode)
- `-f, --force`: Skip confirmation prompt
- `-d, --delete-backup`: Delete backup branch after successful restore
- `-j, --json`: JSON output

**Behavior**:
1. Validate git repository.
2. Determine `targetBranch`:
   - If `--branch` provided, use it.
   - Else use `GitHelper.getCurrentBranch()` (error on detached HEAD).
3. Validate `targetBranch` exists.
4. Discover backups for `targetBranch` (local branches matching prefix `backup/<targetBranch>/`).
5. Choose backup:
   - If `--backup` provided: validate it exists and is within `backup/<targetBranch>/`.
   - Else if `--json`: validation error (“`--backup` required in JSON mode”).
   - Else interactive selection using `@inquirer/prompts` `select()`.
6. Safety checks before applying:
   - If restoring the currently checked-out branch, validate there are no uncommitted changes (`GitHelper.hasUncommittedChanges(process.cwd())`).
   - If restoring a different branch, ensure it is not checked out in another worktree (`GitHelper.findWorktreeByBranch()`); if it is, fail with an operation error that includes the worktree path.
7. Confirmation (unless `--force` or `--json`):
   - Show warning that the branch will be reset.
   - Include current HEAD and target commit.
   - Optionally show “commits that may become unreachable” when restoring the current branch by using `git rev-list --count <backupCommit>..HEAD` (best-effort).
8. Restore:
   - If `targetBranch` is the current branch: `git reset --hard <backupCommit>`.
   - Else: `git branch -f <targetBranch> <backupCommit>`.
9. Optionally delete the backup branch if `--delete-backup`.
10. Print success output:
   - Human: checkmark + previous/new commit + whether backup was deleted.
   - JSON: matches PRD structure under `restore`.

### Backup Discovery + Display

Define a small internal model (either in `src/utils/git.ts` or a dedicated utility file) to represent backups:

```ts
export interface BackupBranchInfo {
  name: string
  sourceBranch: string
  commit: string
  timestamp: string // ISO string (UTC)
  message?: string
}
```

Discovery should use a single git call where possible:

- `git for-each-ref --format='%(refname:short)%00%(objectname)' refs/heads/backup/<branch>`

Then parse the branch name to extract the timestamp segment (`YYYYMMDD-HHmmss`) and convert it to ISO. Messages are fetched via `git config --get branch.<name>.description`.

### Error Handling + Output

- Use `ErrorHelper.validation()` for expected user errors (not a repo, detached HEAD, no backups, etc.).
- Use `ErrorHelper.operation()` for git failures (branch update fails, branch deletion fails).
- Follow existing JSON output conventions:
  - `status: 'success' | 'error' | 'warning'`
  - new fields under `backup` / `restore` matching the PRD examples.

## Source Code Structure Changes

### New Commands

- `src/commands/branch/backup.ts`
- `src/commands/branch/restore.ts`

Both commands follow existing command patterns:

- Parse flags via `this.parse()`
- Validate early; return after `ErrorHelper.validation()`
- No interactive prompts in `--json` mode
- Use `@inquirer/prompts` for selection/confirmation in human mode

### Git Helper Extensions

Extend `src/utils/git.ts` (`GitHelper`) with minimal, focused methods (exact signatures may vary):

- `getCommitHash(ref: string): Promise<string>`
- `forceUpdateBranch(branch: string, commit: string): Promise<void>` (wraps `git branch -f`)
- `resetHard(commit: string): Promise<void>` (wraps `git reset --hard`)
- `setBranchDescription(branch: string, description: string): Promise<void>`
- `getBranchDescription(branch: string): Promise<string | null>`
- `listBackupBranches(sourceBranch: string): Promise<BackupBranchInfo[]>`

### CLI Metadata (Optional)

Add `branch` to `package.json#oclif.topics` with a description to improve `--help` output.

### Documentation

- Update `README.md` with examples for `pando branch backup` and `pando branch restore`.

## Data Model / Interfaces

Primary DTOs for command outputs:

```ts
export interface BackupCreateResult {
  name: string
  sourceBranch: string
  commit: string
  message?: string
  timestamp: string
}

export interface RestoreResult {
  branch: string
  backup: string
  previousCommit: string
  newCommit: string
  backupDeleted: boolean
}
```

Commands should emit either:

- `{ status: 'success', backup: BackupCreateResult }`
- `{ status: 'success', restore: RestoreResult }`

## Delivery Phases (Incremental Milestones)

1. **Git layer**: Extend `GitHelper` with backup/restore primitives and add unit tests.
2. **Backup command**: Implement `pando branch backup` (flags, validation, JSON + human output).
3. **Restore command**: Implement `pando branch restore` (backup discovery, interactive select, confirmation, restore + optional deletion).
4. **Polish** (optional): add relative “age” display, richer confirmation output, and (if desired) PRD extras for list/delete backups.

## Verification Approach

- **Unit tests**: `pnpm test:run` (add coverage for new GitHelper functions, and any pure parsing utilities)
- **Lint/typecheck**: `pnpm lint` and `pnpm typecheck` (or `pnpm validate`)
- **Manual smoke test** (recommended):
  1. `pando branch backup -m "Before rebase"`
  2. Make a commit (or reset/rebase) on the branch
  3. `pando branch restore` and select the backup
  4. Confirm HEAD matches the backup commit

