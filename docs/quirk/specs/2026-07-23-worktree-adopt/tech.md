# Tech Spec: `pando adopt`

Companion to `logic.md` (approved). This is the implementation contract. Grounded
in the current code at the SHAs/line numbers noted; verify before editing.

**Complexity-tier gate:** authored — criterion fired: touches ≳3 source files
(`adopt.ts` new, `git.ts`, `worktreeSetup.ts`, `add.ts`, a new post-command
runner util, plus tests/docs).

## Subsystem anchor

- `src/commands/` — CLI commands (oclif). New `adopt.ts`; `add.ts` refactored to
  share the post-command runner.
- `src/utils/worktreeSetup.ts` — the setup orchestrator. Gains an **adopt mode**.
- `src/utils/git.ts` — `GitHelper`. Gains `getWorktreeByPath`.
- `src/utils/postCommandRunner.ts` (**new**) — shared trust-gated post-command
  execution, extracted from `add.ts`.

## File-level changes

### 1. `src/utils/git.ts` — `getWorktreeByPath`

New method on `GitHelper`:

```ts
async getWorktreeByPath(
  targetPath: string
): Promise<{ info: WorktreeInfo; isMain: boolean } | null>
```

- Resolve `targetPath` and each `listWorktrees()` entry's `path` through
  `fs.realpath` before comparison. **Rationale:** on macOS `/tmp` →
  `/private/tmp`, and `process.cwd()` vs `git worktree list` can differ; a raw
  string compare would spuriously miss. Fall back to `path.resolve` when
  `realpath` throws (path may not exist on disk in edge cases, though for adopt
  it always does).
- `isMain = index === 0` — git porcelain guarantees the main worktree is listed
  first (already relied on in `worktreeMetadata.enumerateAll`, worktreeMetadata.ts:182).
- Returns `null` when no worktree matches.

### 2. `src/utils/worktreeSetup.ts` — adopt mode (the crux)

**DO-NOT-CHANGE fence:** the existing create-time behavior (`adopt` unset) must
be byte-for-byte unchanged. Every new branch is gated on an adopt/dry-run option
that defaults false. `add.ts` passes none of them, so its path is untouched.

`SetupOptions` gains:

```ts
adopt?: boolean                    // enable adopt-safe mode
replaceExistingSymlinks?: boolean  // adopt: replace real files at symlink targets (add-parity)
dryRun?: boolean                   // compute + return the plan, mutate nothing
preexistingDirtyPaths?: string[]   // adopt: baseline dirt to exclude from the clean-tree check
```

`SetupResult` gains an optional plan (populated on dry-run, and on a real adopt
run for reporting):

```ts
plan?: {
  symlinks: { toCreate: string[]; alreadyLinked: string[]; conflicts: string[] }
  rsyncFileCount: number       // untracked-ignored files that would/did sync (onlyUntracked)
  rsyncMode: 'untracked' | 'full' | 'skipped'
}
```

Three behavior changes, each gated on `options.adopt`:

**(a) Non-destructive rollback.** Skip `this.transaction.createCheckpoint('worktree', …)`
(worktreeSetup.ts:187) when `options.adopt`. `rollback()` looks up the `'worktree'`
checkpoint to decide whether to `removeWorktree` (worktreeSetup.ts:536-548); with
no checkpoint it rolls back only the recorded file/rsync/symlink operations and
never touches the worktree. This is the top safety invariant. No change to
`rollback()` itself — it already no-ops the worktree removal when the checkpoint
is absent. Add a code comment at the checkpoint site explaining the adopt skip.

**(b) Preserve-existing symlinks.** `createPlannedSymlinks` (worktreeSetup.ts:585)
gets a `preserveExisting: boolean` parameter, computed by the caller as
`adopt && !replaceExistingSymlinks`:
- `preserveExisting === false` (create-time, or adopt `--replace-existing`):
  unchanged — `fs.remove` each existing target, then
  `createSymlinks({ replaceExisting: true, skipConflicts: true, items })`.
- `preserveExisting === true`: **do not** `fs.remove`. First drop items already
  correctly symlinked (via `symlinkHelper.verifySymlink(target, source)`) so an
  idempotent re-run doesn't report them as conflicts. Then
  `createSymlinks({ replaceExisting: false, skipConflicts: true, items: remaining })`.
  `detectConflicts` (fileOps.ts:1080) flags any real file/dir/wrong-symlink at a
  target; `skipConflicts` skips them into `result.conflicts`, which the existing
  warning path (worktreeSetup.ts:238-240) surfaces. **No user file is deleted.**

**(c) Dirt-tolerant clean-tree check.** In Phase 6 (worktreeSetup.ts:435-454),
subtract `options.preexistingDirtyPaths` (in addition to `symlinkItems`) from
`getDirtyPaths` before deciding `cleanTree`. So `cleanTree` reflects only paths
pando touched, not the user's pre-existing work-in-progress.

**Dry-run.** When `options.dryRun`, after computing `symlinkItems` and the symlink
classification and the rsync file list (`listIgnoredFiles` for untracked mode, or
the commit-match decision for full mode) — return early with
`{ success: true, plan, duration, warnings, rolledBack: false }` before Phase 3.
No symlink/rsync/skip-worktree mutation occurs. Dry-run is meaningful only under
`adopt` in practice, but the short-circuit is independent.

New private helper `classifyAdoptSymlinks(sourceTreePath, worktreePath, symlinkItems, symlinkConfig)`
returns `{ toCreate, alreadyLinked, conflicts }` by stat/verify per item; used by
both the dry-run plan and the preserve-existing no-op filter.

**Accepted limitation (document in code):** adopt-mode rollback reverts recorded
symlink and rsync operations but does not remove the worktree; residual synced
gitignored artifacts, if any survive a partial rollback, are harmless (gitignored,
not user work) and a re-run of `adopt` converges. This is consistent with the
"never delete user work" invariant.

### 3. `src/utils/postCommandRunner.ts` (new) — shared trust-gated runner

Extract `add.ts`'s `runPostCommands` (add.ts:916-971) and `evaluatePostCommandTrust`
(add.ts:979-1090) into one exported function so both commands share the trust gate
(the logic is ~130 lines and must not be duplicated):

```ts
export async function runTrustedPostCommands(params: {
  command: Command
  config: PandoConfig
  commandName: string                 // 'add' | 'adopt' — used in messaging + PANDO_COMMAND
  scriptKey: string                   // config key to read; 'add' | 'adopt'
  fallbackScriptKey?: string          // adopt passes 'add' so existing add hooks run
  context: Omit<PostCommandContext, 'commandName'>
  isJson: boolean
  spinner: Ora | null
  warnings: string[]
}): Promise<PostCommandResult[]>
```

- Scripts = `normalizePostCommandScripts(config, scriptKey)`; if empty and
  `fallbackScriptKey` set, retry with the fallback key.
- Same trust gate (`decidePostCommandTrust`, inquirer confirm, `recordTrust`,
  `PANDO_TRUST_CONFIG`) as today, keyed on `config.postCommandsSourcePath`.
- Emits warnings via `ErrorHelper.warn(command, …)` (non-JSON) or pushes to
  `warnings` (JSON) — same `emitWarning` semantics, inlined.

`add.ts` change: delete the two private methods; call `runTrustedPostCommands`
with `scriptKey: 'add'`, no fallback. **Behavior must stay identical** — add's
existing tests are the guard. No schema change: `postCommands` is already a
free-form `Record<string, PostCommandScript[]>` (schema.ts:184), so the `adopt`
key needs no Zod addition.

### 4. `src/commands/add.ts` — kind-override hook for reuse

`setupLifecycleMetadata` (add.ts:104) currently derives `kind` via
`resolveWorktreeKind(flags, worktreeConfig.defaultKind, …)`. Add an optional
`kindOverride?: WorktreeKind` to `LifecycleOptions`; when present, use it instead
of calling `resolveWorktreeKind`. `add` passes nothing (unchanged). `adopt` passes
its long-lived-default resolution.

New exported helper (in `add.ts` next to `resolveWorktreeKind`, or in `adopt.ts`):

```ts
export function resolveAdoptKind(flags: Record<string, unknown>): WorktreeKind {
  if (flags.ephemeral) return 'ephemeral'
  if (flags['long-lived']) return 'long-lived'
  return 'long-lived'   // adopt default: never auto-reap a hand-made worktree
}
```

`config.worktree.defaultKind` is intentionally ignored for adopt (logic.md
Decisions-Locked).

### 5. `src/commands/adopt.ts` (new) — the command

Flags (from `common-flags` + local): `path` (`pathFlag`), `dry-run`,
`replace-existing`, `ephemeral`/`long-lived` (mutually exclusive), `ttl`, `owner`,
`ports`, `skip-rsync`, `rsync-flags`, `rsync-exclude`, `skip-symlink`, `symlink`,
`absolute-symlinks`, `details`, `json`. Optional positional `path` arg (defaults
to cwd; `--path` also accepted, arg wins if both given — match add's arg/flag
merge pattern).

`run()` flow:

1. `gitHelper.isRepository()` guard (ErrorHelper.validation on failure).
2. Resolve target: positional arg || `--path` || `process.cwd()`; resolve to
   absolute. `gitRoot = getRepositoryRoot()`.
3. `const match = await gitHelper.getWorktreeByPath(target)`:
   - `null` → validation error: "…is not a linked worktree of this repo. Use
     `pando add` to create one."
   - `match.isMain` → validation error: "Cannot adopt the main worktree."
4. Load + merge config (reuse the same flag-override logic as
   `add.loadAndMergeConfig`; factor the shared override block into a small helper
   or replicate — see Open item below).
5. `readMetadata(target)`; if `metadata.kind !== undefined`, note "already managed
   by pando — re-applying" (idempotent; not an error).
6. Baseline dirt: `preexistingDirtyPaths = await gitHelper.getDirtyPaths(target)`
   (best-effort; used to refine clean-tree check and to report preserved work).
7. Build setup options: `{ adopt: true, dryRun: flags['dry-run'],
   replaceExistingSymlinks: flags['replace-existing'], skipRsync, skipSymlink,
   preexistingDirtyPaths, onProgress }`.
8. `const setup = await orchestrator.setupNewWorktree(target, setupOptions)`.
   - **No SIGINT rollback-that-removes-worktree** — adopt mode already makes
     rollback non-destructive; a SIGINT handler, if registered, calls the same
     non-destructive `rollback()`. (Reuse add's handler; it is safe under adopt.)
9. If `flags['dry-run']`: format the plan (human/JSON) and return — skip
   lifecycle/post-commands entirely.
10. Lifecycle: `setupLifecycleMetadata({ …, kindOverride: resolveAdoptKind(flags),
    sourceBranch: config.worktree.targetBranch, worktreeBranch: match.info.branch })`.
    `mainRepoPath` resolved as in add.ts:432-434.
11. Post-commands: `runTrustedPostCommands({ command: this, config, commandName:
    'adopt', scriptKey: 'adopt', fallbackScriptKey: 'add', context: { cwd: target,
    worktreePath: target, branch: match.info.branch, commit: match.info.commit,
    kind, ttl, ports, dbName }, … })`.
12. `formatOutput` — adopt-specific (below).

`sourceBranch` for metadata = `config.worktree.targetBranch` (default `main`),
per logic.md. Detached-HEAD target → `match.info.branch` is `null`; lifecycle
still records `targetBranch` as sourceBranch and uses `basename(path)` for the db
name (setupLifecycleMetadata already handles `worktreeBranch ?? basename`).

Output (`formatOutput`), two modes:
- **Dry-run:** header "Would adopt <path>"; list symlinks to create /
  already-linked / conflicts (skipped, with reason); rsync file count + mode;
  metadata that would be written (kind, sourceBranch, owner, ttl); ports that
  would allocate (note: allocation is not simulated in v1 — state "ports: would
  allocate N in range" without probing). JSON: `{ success: true, dryRun: true,
  plan: {…}, wouldWrite: {…} }`.
- **Real:** header "✓ Adopted <path>"; branch/commit/kind; symlinks
  created/skipped(conflicts with reasons)/already-linked; rsync files; ports/db;
  post-command results; `cleanTree`; preserved-dirty summary ("N pre-existing
  changes left untouched"); warnings. JSON mirrors add's shape plus
  `adopted: true`, `preexistingDirty: string[]`, and the symlink conflict list.

Error handling: reuse the `SetupError` / generic branches from add's
`handleError`, MINUS any "rolled back / worktree removed" framing — adopt failures
never remove the worktree. Message on `SetupError`: "Adopt failed; the worktree
and your changes were left untouched." Re-throw oclif exit errors
(`isOclifExitError`).

### 6. Docs

- `README.md` — `pando adopt` section: purpose, flags, `--dry-run`,
  `--replace-existing`, the "never touches your work" guarantee, `postCommands.adopt`.
- `.pando.toml.example` — document `[postCommands] adopt = [...]`.
- `src/commands/DESIGN.md` — add adopt to the command inventory + the adopt-mode
  note on the orchestrator.

## Open item (resolve during impl)

The rsync/symlink flag-override block in `add.loadAndMergeConfig` (add.ts:650-688)
is identical to what adopt needs. Prefer extracting it to a small shared helper
`applySetupFlagOverrides(config, flags, emitWarning)` used by both; if that proves
to entangle add's warnings plumbing, replicate the ~30 lines in adopt and note it.
Decide in favor of extraction unless it grows add's risk.

## Test plan (TDD — write tests first per unit)

Unit (vitest, test logic directly per CLAUDE.md):
- `git.getWorktreeByPath`: matches by realpath; returns `isMain` for index 0;
  `null` for a non-worktree path; handles symlinked temp dirs.
- `worktreeSetup` adopt mode:
  - adopt + real file at symlink target → skipped as conflict, file still on disk,
    no throw.
  - adopt + already-correct symlink → no-op, not reported as conflict (idempotent).
  - adopt + `replaceExistingSymlinks` → replaces (add-parity).
  - adopt failure path → worktree NOT removed (assert dir still exists), file ops
    rolled back.
  - adopt + `preexistingDirtyPaths` → clean-tree check excludes them.
  - `dryRun` → returns `plan`, mutates nothing (no symlinks created, no rsync).
  - create-time (adopt unset) → unchanged (existing tests still green).
- `resolveAdoptKind`: ephemeral/long-lived flags, default long-lived.
- `runTrustedPostCommands`: fallback key; trust-skip in JSON/non-TTY; env trust.
- `postCommandRunner` extraction: add's post-command tests still pass.

E2E (Docker, real git — `--hookTimeout=60000`):
- Raw `git worktree add` → `pando adopt <path>` → metadata written, symlinks
  created, gitignored artifacts synced, exit 0, git status clean aside from
  pando symlinks.
- Adopt a dirty worktree (uncommitted tracked change + untracked file) →
  changes preserved, exit 0.
- Adopt with a real `node_modules` present at a symlink target → skipped+warned,
  real dir preserved; with `--replace-existing` → replaced by symlink.
- `--dry-run` → no changes on disk, plan printed; `--json` well-formed.
- Adopt the main worktree → validation error, exit non-zero.
- Adopt a non-worktree dir → validation error.
- Idempotent: adopt twice → second run converges, no errors.

## Acceptance commands

```
pnpm build
pnpm lint
pnpm test
pnpm vitest run test/e2e/adopt.e2e.test.ts --hookTimeout=60000
```

## DO-NOT-CHANGE

- Create-time setup behavior (orchestrator with `adopt` unset) — byte-identical.
- `add`'s observable output/JSON shape and its post-command trust semantics.
- The rsync `onlyUntracked` default and the "never copy tracked files" invariant.
- `rollback()`'s worktree-removal path for the create-time flow.
