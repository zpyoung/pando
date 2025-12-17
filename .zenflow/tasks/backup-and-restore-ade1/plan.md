# Full SDD workflow

## Configuration
- **Artifacts Path**: {@artifacts_path} → `.zenflow/tasks/{task_id}`

---

## Workflow Steps

### [x] Step: Requirements
<!-- chat-id: d7f6df36-8489-41c6-a290-1c5d6eafb948 -->

Create a Product Requirements Document (PRD) based on the feature description.

1. Review existing codebase to understand current architecture and patterns
2. Analyze the feature definition and identify unclear aspects
3. Ask the user for clarifications on aspects that significantly impact scope or user experience
4. Make reasonable decisions for minor details based on context and conventions
5. If user can't clarify, make a decision, state the assumption, and continue

Save the PRD to `{@artifacts_path}/requirements.md`.

### [x] Step: Technical Specification
<!-- chat-id: c572a307-a658-41ca-9d1e-4f3b39a5c1ef -->

Create a technical specification based on the PRD in `{@artifacts_path}/requirements.md`.

1. Review existing codebase architecture and identify reusable components
2. Define the implementation approach

Save to `{@artifacts_path}/spec.md` with:
- Technical context (language, dependencies)
- Implementation approach referencing existing code patterns
- Source code structure changes
- Data model / API / interface changes
- Delivery phases (incremental, testable milestones)
- Verification approach using project lint/test commands

### [x] Step: Planning
<!-- chat-id: 8ac1b2d2-ca9c-4af4-8b8b-48a8435e179a -->

Create a detailed implementation plan based on `{@artifacts_path}/spec.md`.

1. Break down the work into concrete tasks
2. Each task should reference relevant contracts and include verification steps
3. Replace the Implementation step below with the planned tasks

Rule of thumb for step size: each step should represent a coherent unit of work (e.g., implement a component, add an API endpoint, write tests for a module). Avoid steps that are too granular (single function) or too broad (entire feature).

If the feature is trivial and doesn't warrant full specification, update this workflow to remove unnecessary steps and explain the reasoning to the user.

Save to `{@artifacts_path}/plan.md`.

---

## Implementation Plan

### [x] Step: Extend GitHelper for backups
<!-- chat-id: 6a6acfad-c618-478b-b2b7-73903073cacd -->

**Goal**: Add the Git primitives and data models required by `branch backup` and `branch restore`.

**Contracts (from spec)**:
- `BackupBranchInfo` (internal model for discovered backups)
- `BackupCreateResult` (command output)
- `RestoreResult` (command output)

**Code changes**:
- `src/utils/git.ts`
  - Add `export interface BackupBranchInfo { name; sourceBranch; commit; timestamp; message? }`
  - Add backup/restore primitives:
    - `getCommitHash(ref: string): Promise<string>`
    - `forceUpdateBranch(branch: string, commit: string): Promise<void>`
    - `resetHard(commit: string): Promise<void>`
    - `setBranchDescription(branch: string, description: string): Promise<void>`
    - `getBranchDescription(branch: string): Promise<string | null>`
    - `listBackupBranches(sourceBranch: string): Promise<BackupBranchInfo[]>`
  - Add/adjust worktree detection for restore safety (avoid fuzzy false-positives):
    - Option A: new `findWorktreeByBranchExact(branchName: string)`
    - Option B: extend `findWorktreeByBranch(branchName, { fuzzy: boolean })`
- (Optional but recommended for testability) New utility module:
  - `src/utils/branch-backups.ts`
    - `formatBackupTimestamp(date: Date): string` (`YYYYMMDD-HHmmss` in UTC)
    - `toIsoSeconds(date: Date): string` (strip milliseconds)
    - `parseBackupBranchName(name: string): { sourceBranch: string; timestamp: string } | null`

**Tests**:
- `test/utils/git.test.ts`
  - Add coverage for each new GitHelper method (mock `git.raw` calls + parsing).
- If adding `src/utils/branch-backups.ts`, add `test/utils/branch-backups.test.ts`.

**Verification**:
```bash
pnpm test:run test/utils/git.test.ts
```

### [x] Step: Implement `pando branch backup`
<!-- chat-id: 16fdb837-f5a4-4b49-90bb-c2bc29f121f6 -->

**Goal**: Create a timestamped backup branch for the current/specified branch.

**Code changes**:
- `src/commands/branch/backup.ts`
  - Flags: `--branch/-b`, `--message/-m`, `--json/-j`
  - Behavior:
    1. Validate git repo (`GitHelper.isRepository()`)
    2. Determine `sourceBranch` (flag or `getCurrentBranch()`; validation error on detached HEAD)
    3. Validate `sourceBranch` exists (`branchExists()`)
    4. Create backup name `backup/<sourceBranch>/<timestamp>`
    5. Create backup branch at `sourceBranch` commit
    6. Store optional message via `setBranchDescription()`
    7. Output:
       - JSON: `{ status: 'success', backup: BackupCreateResult }`
       - Human: checkmark + source/commit + message

**Tests**:
- Prefer unit tests for any new timestamp/name utilities (avoid oclif mocking).

**Verification**:
```bash
pnpm dev branch backup --help
pnpm test:run
```

### [x] Step: Implement `pando branch restore`
<!-- chat-id: 94b88264-f23e-4fe8-9377-fde10455de3a -->

**Goal**: Reset a target branch to match a selected backup branch.

**Code changes**:
- `src/commands/branch/restore.ts`
  - Flags: `--branch/-b`, `--backup`, `--force/-f`, `--delete-backup/-d`, `--json/-j`
  - Behavior:
    1. Validate git repo
    2. Determine `targetBranch` (flag or current; validation error on detached HEAD)
    3. Validate `targetBranch` exists
    4. Discover backups with `listBackupBranches(targetBranch)`
    5. Choose backup:
       - `--backup` validates existence + `backup/<targetBranch>/` prefix
       - `--json` without `--backup` => validation error
       - otherwise interactive `select()` in human mode
    6. Safety checks:
       - If restoring checked-out branch: require clean working tree (`hasUncommittedChanges(process.cwd())`)
       - If restoring another branch: fail if branch is checked out in another worktree (exact match)
    7. Confirmation prompt unless `--force` or `--json` (best-effort “unreachable commits” count)
    8. Restore:
       - Current branch: `resetHard(backupCommit)`
       - Other branch: `forceUpdateBranch(targetBranch, backupCommit)`
    9. Optional delete backup:
       - Attempt `deleteBranch(backupName, true)`; if it fails, warn and continue
    10. Output:
       - JSON: `{ status: 'success'|'warning', restore: RestoreResult, warning? }`
       - Human: checkmark + previous/new commit + backup deletion status

**Tests**:
- Add unit tests for backup discovery parsing and any helper utilities used for formatting/choice building.

**Verification**:
```bash
pnpm dev branch restore --help
pnpm test:run
```

### [x] Step: Add E2E coverage for backup/restore
<!-- chat-id: 06c3eb6a-c868-458f-80f2-4d6ff31af5d6 -->

**Goal**: Validate real git behavior end-to-end without interactive prompts.

**Code changes**:
- `test/e2e/helpers/cli-runner.ts` (optional convenience wrappers)
- `test/e2e/commands/branch-backup.e2e.test.ts`
  - Create repo, run `pando branch backup --message ... --json`
  - Assert JSON shape and that the backup branch exists
- `test/e2e/commands/branch-restore.e2e.test.ts`
  - Create backup, make an extra commit, restore using `--backup <name> --force --json`
  - Assert HEAD matches backup commit
  - Assert `--delete-backup` removes the backup branch
  - Assert `--json` without `--backup` fails

**Verification**:
```bash
pnpm test:e2e
```

### [x] Step: Wire CLI metadata + docs
<!-- chat-id: 1037aaac-beb1-413f-9a66-891cc0b652ad -->

**Code changes**:
- `package.json`: add `oclif.topics.branch` description (improves `--help` output)
- `README.md`: document `pando branch backup` and `pando branch restore` with examples + flag tables

**Verification**:
```bash
pnpm dev --help
```

### [x] Step: Final validation
<!-- chat-id: 58a749c1-de6a-4089-b8c9-3486c6a63347 -->

Run the standard project checks and record results here.

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test:run
pnpm test:e2e
```

**Results (2025-12-17)**:
| Check | Status |
|-------|--------|
| `pnpm format` | ✓ All files unchanged |
| `pnpm lint` | ✓ No errors |
| `pnpm typecheck` | ✓ No type errors |
| `pnpm test:run` | ✓ 457 unit tests passed |
| `pnpm test:e2e` | ✓ 104 E2E tests passed |
