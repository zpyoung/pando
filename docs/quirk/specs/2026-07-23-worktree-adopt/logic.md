# Logic Spec: `pando adopt` — worktree takeover

## Status

Approved — ready for implementation.

## Purpose

Let pando run against a git worktree it did **not** create (e.g. one made by raw
`git worktree add`, or by another tool such as Orca) and bring it under pando
management: run the standard setup (rsync of untracked artifacts, symlinks,
skip-worktree, lifecycle metadata, port allocation, post-commands). After a
successful adopt, the worktree is indistinguishable from one created by
`pando add`.

This is the **setup-only half of `add`**: `git worktree add` is removed, and
safety rails are added because the target may already contain real, uncommitted
work.

## Conceptual model

`pando add` today runs, in order: validate → `git worktree add` → setup
(rsync/symlink) → lifecycle metadata + ports → post-commands → output.

`pando adopt` reuses the tail of that pipeline against a pre-existing worktree:

```
resolve & validate target  →  read existing state  →  load config  →
compute plan  →  [--dry-run? emit & exit]  →  apply setup (adopt-safe mode)  →
lifecycle metadata + ports  →  post-commands  →  output
```

The worktree already exists on disk and is already a linked worktree of the
repo; adopt never creates or removes it.

## Command surface

```
pando adopt [path]
```

- `[path]` — optional; defaults to the current working directory. Resolved to an
  absolute path and confirmed to be a **linked** worktree of the current repo.

Flags (mirror `add` where meaningful):

| Flag | Purpose |
|------|---------|
| `--dry-run` | Print the full plan (human or JSON), change nothing, exit 0 |
| `--replace-existing` | Replace real files at symlink targets instead of skip+warn |
| `--long-lived` (default) / `--ephemeral` | Lifecycle kind |
| `--ttl <dur>` / `--owner <name>` / `--ports` | Lifecycle metadata / port allocation |
| `--skip-rsync` / `--skip-symlink` | Skip a setup phase |
| `--rsync-flags` / `--rsync-exclude` / `--symlink` / `--absolute-symlinks` | Setup overrides (same semantics as `add`) |
| `--json` / `--details` | Output format |

## Data flow (prose)

1. **Resolve & validate target.** Resolve `[path]`/cwd → absolute path. Confirm
   it is a linked worktree of this repo by matching against
   `gitHelper.listWorktrees()`. Reject with a clear validation error when:
   - not inside/there-is-no git repo,
   - the path is the **main** worktree (cannot adopt main),
   - the path is not a linked worktree of this repo.
   Read the worktree's branch from its `WorktreeInfo`; tolerate detached HEAD
   (no branch → still adoptable, `sourceBranch` falls back per the rule below).
   Run `assertGitVersion()` then `ensureWorktreeConfigEnabled(gitRoot)` (both
   idempotent, same as `add`).

2. **Read existing state.** `readMetadata(worktreePath)`. If `kind` is already
   defined, the worktree is already pando-managed → log "already managed,
   re-applying" and continue (idempotent re-apply). Capture the dirty file set
   via `getDirtyPaths(worktreePath)` — **not** `hasUncommittedChanges`, which
   fails open (returns `false` on error). Dirty state is recorded, never a
   blocker.

3. **Load config.** Same `loadAndMergeConfig` path as `add` (defaults → file →
   env → flag overrides for rsync/symlink/ports).

4. **Compute plan** (always computed; consumed by both `--dry-run` and apply):
   - **Symlink plan** — matched glob patterns minus git-tracked paths (unless
     `allowTracked`); classify each planned target:
     - *create* — nothing at the path,
     - *no-op* — already the correct symlink,
     - **conflict** — a real file/dir with content sits at the path.
   - **Rsync plan** — the untracked-ignored file set from
     `listIgnoredFiles(sourceTreePath)` (`onlyUntracked` mode). Full-mirror mode
     (`onlyUntracked=false`) still requires source/target commits to match; a
     foreign worktree usually differs, so it skips with a warning (unchanged
     from today's behavior).
   - **Metadata plan** — kind (default long-lived), `sourceBranch` (see decision
     below), owner, ttl, and ports to allocate.

5. **`--dry-run` gate.** If set, emit the plan and exit 0 without any mutation.
   Human output lists symlinks to create / skip-conflict / replace, rsync file
   count, metadata + ports to be written. JSON emits the same as a structured
   `preview` object.

6. **Apply setup (adopt-safe mode).** Call
   `WorktreeSetupOrchestrator.setupNewWorktree(worktreePath, { adopt: true, … })`.
   `setupNewWorktree` already tolerates a pre-existing worktree (Phase 1 only
   checks `pathExists`). The new `adopt` mode changes exactly three behaviors —
   see "Adopt-safe orchestrator mode" below.

7. **Lifecycle metadata + ports.** Shared helper (extracted from `add`'s current
   private `setupLifecycleMetadata`) writes `pando.kind` (long-lived default),
   `pando.sourceBranch`, `pando.owner`, `pando.ttl`, optional autolock, and
   allocates ports via `allocate()` when `--ports`/config enables it.

8. **Post-commands.** Run `postCommands.adopt` if defined; otherwise fall back to
   `postCommands.add`. Trust-gated exactly like `add`.

9. **Output.** Human + `--json`. Report: worktree path, branch, kind, symlinks
   (created / skipped-conflict / replaced), rsync file count, ports, post-command
   results, `cleanTree`.

## Adopt-safe orchestrator mode

`SetupOptions` gains `adopt?: boolean`. When true, three and only three
behaviors change versus the create-time path:

1. **Non-destructive rollback (top safety invariant).** On any setup failure,
   `rollback()` reverts only the file operations pando performed in *this run*
   (symlinks it created, files it synced). It must **never** call
   `gitHelper.removeWorktree(...)`. A failed adopt can never delete a worktree
   pando did not create. Implementation: the checkpoint that today drives the
   destructive `git worktree remove` is either not created in adopt mode, or
   `rollback()` skips the worktree-removal step when `adopt` is set.

2. **Symlink conflicts skip, not clobber.** The symlink phase stops doing
   unconditional `fs.remove()` on the target. A real file/dir at a planned
   symlink target is skipped and warned. `--replace-existing` opts back into the
   remove-then-symlink behavior for those conflicts only.

3. **Dirt-tolerant validation.** The post-setup "clean tree" check accounts for
   pre-existing user dirt: only pando's own additions must be clean. Adopting a
   work-in-progress worktree must not fail validation because the user already
   had uncommitted changes.

Everything else about `setupNewWorktree` (rsync `onlyUntracked`, skip-worktree
marking of symlinked tracked paths, symlink verification) is reused unchanged.

## Decisions Locked

### Command & invocation
- **New dedicated `pando adopt` command** (not an `add --adopt` flag, not
  `pando setup`). Keeps `add` focused on creation; distinct help/flags; matches
  industry naming (Terraform `import`, Helm `--take-ownership`).
- **Target = current directory by default, optional `[path]` argument.** Matches
  "running pando *in* a worktree." Validates the target is a linked worktree.

### Safety on existing work
- **Adopt dirty worktrees; never touch tracked/modified files.** Proceed even
  with uncommitted changes (that is the point). Only sync gitignored/untracked
  artifacts and create symlinks. Warn about dirt, never block on it.
- **Symlink conflicts: skip + warn by default; `--replace-existing` to replace.**
  Never silently delete real local files.

### Lifecycle & idempotency
- **Default lifecycle kind: long-lived.** A hand-created worktree with real work
  is presumably valuable and should not be auto-reaped. Override with
  `--ephemeral`/`--ttl`. (Differs from `add`, which follows
  `config.worktree.defaultKind`.)
- **Idempotent re-apply.** If the worktree already has pando metadata, adopt
  re-runs setup convergently (re-sync untracked, re-verify symlinks, refresh
  metadata). Doubles as a "repair / re-setup." No `--force` required to re-run.

### Preview & scope
- **`--dry-run` preview.** Prints the full plan (symlinks with conflicts flagged,
  rsync file count, metadata/ports) without mutating. Works with `--json`.
- **Full parity with `add`.** Runs rsync + symlinks + metadata + ports +
  post-commands by default; the same `--skip-*` flags apply.

### Open-but-defaulted (react during review)
- **`sourceBranch` metadata = `config.worktree.targetBranch`.** `add` records the
  branch it branched *from*; adopt has no such moment, so it records the
  integration branch (e.g. `main`/`develop`) since that is what reap/stale
  detection compares against. Alternatives: store the worktree's own current
  branch, or omit. **Chosen: `targetBranch`.**
- **`--replace-existing` flag name** (vs `--force`, `--overwrite`,
  `--replace-symlinks`). `add`'s `--force` already means "reset branch," so a
  distinct name avoids overloading. **Chosen: `--replace-existing`.**
- **Post-commands key: `postCommands.adopt` with fallback to `postCommands.add`.**
  Gives parity by default (existing `add` hooks run) while allowing
  adopt-specific overrides. Alternatives: `adopt`-only (no fallback), or reuse
  `add` directly.

## Behavior & scenarios

- **Clean foreign worktree, no conflicts** — full setup applied; metadata
  stamped long-lived; ports allocated; `cleanTree: true`; output lists created
  symlinks + synced file count.
- **Dirty foreign worktree (uncommitted work)** — setup applied; tracked/modified
  files untouched; warning lists dirty paths; `cleanTree` reflects pando's own
  additions only.
- **Real file where a symlink is planned** — that item skipped + warned; rest of
  setup proceeds; `--replace-existing` replaces it instead.
- **Already pando-managed** — logs "already managed, re-applying"; converges;
  metadata refreshed.
- **`--dry-run`** — plan printed/emitted; zero mutation; exit 0.
- **Setup fails mid-apply** — non-destructive rollback reverts only pando's own
  file ops this run; the worktree and all user work survive; command exits
  non-zero with the partial result.
- **Target is the main worktree / not a worktree / not a repo** — validation
  error, no mutation.
- **Detached HEAD** — adoptable; `sourceBranch` falls back to
  `config.worktree.targetBranch`.

## Scope & non-goals

Out of scope:
- Adopting a directory that is not a linked worktree.
- Adopting the main worktree.
- Creating worktrees (that remains `pando add`).
- A general "repair" tool beyond idempotent re-apply.
- Git-config migration beyond what `ensureWorktreeConfigEnabled` already does.

## New / changed pieces

- **New** `src/commands/adopt.ts` — the command.
- **New** `GitHelper.getWorktreeByPath(absPath): Promise<WorktreeInfo | null>` —
  resolve+match a linked worktree by absolute path (no such helper exists today).
- **Changed** `src/utils/worktreeSetup.ts` — add `SetupOptions.adopt` mode (the 3
  behavior changes) and symlink-conflict classification in the plan.
- **Refactor** `add`'s private `setupLifecycleMetadata` into a shared helper
  consumed by both `add` and `adopt`.
- **New** `postCommands.adopt` config key (schema + `.add` fallback wiring).
- **Docs** — README (command + flags), `.pando.toml.example` (`postCommands.adopt`),
  `src/commands/DESIGN.md`, config schema doc.

## Industry Insights

- **Naming**: "adopt" is the fitting verb for bringing an externally-created
  resource under management — Terraform uses `import`, Helm 3.17+ adds
  `--take-ownership`, Kubernetes uses annotation-based adoption, Cargo `init`
  bootstraps an existing dir. "Import"/"init" carry different connotations; the
  ownership-transfer framing fits a worktree takeover best.
  ([Terraform import](https://scalr.com/learning-center/the-ultimate-guide-to-terraform-import),
  [Helm --take-ownership](https://alexandre-vazquez.com/helm-take-ownership/),
  [Cargo init](https://doc.rust-lang.org/cargo/commands/cargo-init.html))
- **Dry-run is near-mandatory** for takeover-class operations that mutate
  pre-existing state; it must be *detailed* (which files, which symlink targets,
  conflict flags), not just "operation would occur." Terraform `plan`, Ansible
  `--check`, Kubernetes `--dry-run` normalized this.
  ([Dry-run engineering](https://dev.to/danieljglover/dry-run-engineering-the-simple-practice-that-prevents-production-disasters-ek0),
  [CLI preview patterns](https://nickjanetakis.com/blog/cli-tools-that-support-previews-dry-runs-or-non-destructive-actions))
- **Symlink creation over real files is dangerous** — `ln -sf` is non-atomic
  (unlink+symlink race), and remove-then-create can clobber real content. Check
  target type before acting; never delete a real file to make a symlink without
  explicit opt-in. ([node-tar symlink advisory](https://github.com/isaacs/node-tar/security/advisories/GHSA-9r2w-394v-53qc))
- **Protect dirty state before mutating** — check `git status` first; for an
  adopt whose *purpose* is work-in-progress, that means protecting (not
  blocking) dirty files: sync only untracked-ignored artifacts, never tracked or
  modified files.
- **Idempotency via check-before-act & non-destructive failure** — guard each
  phase on current state; prefer checkpoint/resume over destructive rollback;
  never leave a half-applied worktree worse than found.
  ([Shell idempotency](https://www.commandinline.com/shell-script-idempotency-safe-rerun-patterns/),
  [idempotent agent ops](https://www.agentpatterns.ai/agent-design/idempotent-agent-operations/))
- **Detect "already managed"** — Terraform errors on double-import, Helm/K8s check
  ownership metadata. Here: `readMetadata().kind !== undefined` signals an
  already-adopted worktree → idempotent re-apply rather than error.

## Deferred Ideas

None — discussion stayed within scope.

## Glossary

- **Worktree** — a linked working directory of a git repo (`git worktree`),
  sharing the repo's object store but with its own checked-out branch.
- **Main worktree** — the primary working directory (first entry of
  `git worktree list`); cannot be adopted.
- **Foreign worktree** — a worktree created outside pando (raw `git worktree add`
  or another tool) with no `pando.*` metadata.
- **Adopt-safe mode** — the `SetupOptions.adopt` orchestrator variant: non-
  destructive rollback, skip-not-clobber symlinks, dirt-tolerant validation.
- **`onlyUntracked` rsync** — the default mode that syncs only gitignored/untracked
  artifacts (e.g. `node_modules`, `.venv`), never tracked files.
- **skip-worktree** — `git update-index --skip-worktree`, used to hide
  pando-created symlinks of tracked paths from `git status`.
- **Lifecycle kind** — `ephemeral` (reapable by TTL) vs `long-lived`; stored as
  `pando.kind`.

## Status & amendments

**Amendments:** none yet.
