# Pando

[![npm version](https://img.shields.io/npm/v/@zyoung-ff/pando.svg)](https://www.npmjs.com/package/@zyoung-ff/pando)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/@zyoung-ff/pando.svg)](https://nodejs.org/)

> A TypeScript-based CLI for managing Git worktrees with automation-first design

Pando makes it effortless to work on multiple branches simultaneously using Git worktrees. Built for modern developer workflows, it provides both human-friendly commands and machine-readable output for CI/CD automation.

## Features

- 🌳 **Worktree Management**: Create, list, and remove git worktrees with ease
- 🤖 **Automation-First**: Every command supports `--json` flag for scripting and AI agents
- 🎯 **Developer-Friendly**: Interactive prompts when flags aren't provided
- ⚡ **Fast**: Built with TypeScript for type safety and performance
- 🔧 **Extensible**: Clean architecture makes adding new commands simple

## Installation

### Using Homebrew (macOS/Linux)

> **Not yet available.** The Homebrew tap (`zpyoung/homebrew-pando`) has not been
> published; until it exists, install via pnpm/npm below. Tracked in
> [ROADMAP.md](./ROADMAP.md).

```bash
# Coming soon
brew tap zpyoung/pando
brew install pando
```

### Using pnpm

```bash
pnpm install -g @zyoung-ff/pando
```

### Using npm

```bash
npm install -g @zyoung-ff/pando
```

### From source

```bash
git clone https://github.com/zpyoung/pando.git
cd pando
pnpm install
pnpm build
pnpm link --global
```

## Quick Start

```bash
# Initialize configuration (optional but recommended)
pando config init

# Create a new worktree for a feature branch
pando add --path ../feature-x --branch feature-x

# List all worktrees
pando list

# Remove a worktree (interactive selection or direct with --path)
pando remove
pando remove --path ../feature-x

# View current configuration and sources
pando config show
```

## Commands

### `pando add`

Create a new git worktree (supports both creating new branches and checking out existing branches)

**Flags:**

- `-p, --path`: Path for the new worktree (optional if `worktree.defaultPath` is configured)
- `-b, --branch`: Branch to checkout or create (also accepted as a positional argument, e.g. `pando add feature-x`)
- `-c, --commit`: Commit hash to base the new branch on
- `-f, --force`: Force create branch even if it exists (uses git worktree add -B)
- `--no-rebase`: Skip automatic rebase of existing branch onto source branch
- `--ephemeral`: Mark the worktree as ephemeral (mutually exclusive with `--long-lived`)
- `--long-lived`: Mark the worktree as long-lived (mutually exclusive with `--ephemeral`)
- `--ttl <duration>`: Set a per-worktree TTL override (for example, `30m` or `2d`)
- `--owner <id>`: Record an owner or agent session id
- `--ports`: Force-enable port allocation for this run (allocation support is forthcoming)
- `--skip-rsync`: Skip the rsync copy step (ignores rsync config)
- `--rsync-flags`: Override rsync flags (comma-separated; repeatable)
- `--rsync-exclude`: Additional rsync exclude patterns (comma-separated; repeatable)
- `--skip-symlink`: Skip symlink creation (ignores symlink config)
- `--symlink`: Additional symlink patterns, overriding config (comma-separated; repeatable)
- `--absolute-symlinks`: Use absolute paths for symlinks instead of relative
- `--details`: Show detailed setup information after the worktree is created
- `-j, --json`: Output in JSON format

> When `--skip-rsync` is combined with `--rsync-flags` or `--rsync-exclude`, the rsync flags are ignored and a warning is shown.

**Lifecycle metadata**: `pando add` stores the worktree kind, creation time, source branch, and optional owner/TTL in Git's per-worktree config. Flags override `worktree.defaultKind`; `auto` treats Claude worktree paths, active agent-session environments, and boolean `PANDO_EPHEMERAL=true|1|yes` signals as ephemeral, and other worktrees as long-lived. Worktrees created during an active `CLAUDE_SESSION_ID` or `PANDO_SESSION` are automatically Git-locked when `worktree.autoLockActive` is enabled; passing `--owner` alone does not trigger auto-locking.

**Automatic Rebase**: When checking out an existing branch, pando automatically rebases it onto the current branch. This keeps your feature branches up-to-date. If the rebase fails (e.g., conflicts), a warning is shown but the worktree is still created. Use `--no-rebase` to skip this behavior, or set `worktree.rebaseOnAdd = false` in config.

**Rsync Behavior**: By default (`rsync.onlyUntracked = true`), rsync carries over only files that git ignores in the source worktree — build artifacts like `.venv/`, `node_modules/`, and caches. Tracked files always come from the new worktree's own checkout, so rsync can never dirty the tree, and artifact syncing works even when the new worktree is on a different branch or commit. Non-ignored untracked files (work in progress) are deliberately not copied. With `rsync.onlyUntracked = false`, pando mirrors the full source tree instead, but only when the source and new worktree are on the same commit — otherwise rsync is skipped with a warning so tracked files from the source branch do not dirty the new checkout. Use `--skip-rsync` to disable rsync explicitly.

**Clean-tree check**: After setup, pando runs `git status` in the new worktree. If anything unexpected shows up (beyond the symlinks pando itself created), a warning lists the offending paths, and JSON output reports `setup.cleanTree: false` so automation can detect it.

**Symlinking tracked paths**: When a symlink pattern matches a git-tracked path (`package.json`, a lockfile), replacing the checked-out file with a symlink would make `git status` report deletions/modifications — so pando hides those entries via `git update-index --skip-worktree`. Untracked/gitignored patterns need no hiding and are filtered from the skip-worktree step automatically. Skip-worktree is local, per-clone state that git can silently drop; the clean-tree check surfaces any drift. Set `symlink.allowTracked = false` for strict mode: tracked patterns are then skipped with a warning, and only gitignored paths get symlinked.

**Examples:**

```bash
# Create new branch in worktree
pando add --path ../feature-x --branch feature-x

# Checkout existing branch into worktree
pando add --path ../existing --branch existing-branch

# Using config default path (if worktree.defaultPath is set in .pando.toml)
pando add --branch feature-x
# OR using shorthand (positional argument)
pando add feature-x

# From specific commit
pando add --path ../hotfix --branch hotfix --commit abc123

# Force reset existing branch to commit
pando add --path ../feature --branch feature-x --commit abc123 --force

# Show detailed setup output, including rsync totals and sample symlink paths
pando add --path ../feature-x --branch feature-x --details
```

When `--details` is used with `--json`, the response includes a stable `details` object with `rsync` totals and `symlink` counts/sample paths. Without `--details`, default human and JSON output are unchanged.

### `pando list`

List all git worktrees

**Flags:**

- `-v, --verbose`: Show detailed information
- `-j, --json`: Output in JSON format

**Examples:**

```bash
pando list
pando list --verbose
pando list --json
```

Verbose human output includes compact kind, owner, age, and lock details. JSON output always includes `kind`, `createdAt`, `owner`, `ttl`, `ageMs`, and `locked` for every worktree (nullable metadata fields are `null`).

### `pando health`

Show health status of all worktrees

**Flags:**

- `-j, --json`: Output in JSON format

**Health Status Types:**

- `clean`: No issues detected
- `uncommitted`: Has modified files (shows count)
- `behind`: Branch is N commits behind upstream
- `gone`: Remote tracking branch was deleted
- `detached`: Worktree is in detached-HEAD state (no branch)
- `error`: Cannot check status (directory missing, git error, or remote check failed)

Each human report entry also shows lifecycle kind and lock state. JSON worktree entries include `kind`, `ageMs`, `ttl`, `locked`, and `owner` alongside the health fields.

**Examples:**

```bash
# Show human-readable health report
pando health

# Output in JSON format
pando health --json
```

**Human Output Example:**

```
Worktree Health Report
==================================================

🚨 Uncommitted changes:
  /worktree/feature-auth
    Branch: feature/auth
    2 files modified

⚠️  Behind upstream:
  /worktree/feature-fix
    Branch: feature/fix
    3 commits behind
    Remote: origin/feature/fix

👻 Remote branch gone:
  /worktree/old-feature
    Branch: feature/old
    remote branch deleted

✅ All good:
  /worktree/main
    Branch: main
  /worktree/develop
    Branch: develop

Total: 5 worktrees
```

### `pando remove`

Remove a git worktree

**Flags:**

- `-p, --path`: Path to the worktree to remove (optional - will prompt interactively if omitted)
- `-f, --force`: Force removal even with uncommitted changes
- `-k, --keep-branch`: Keep the local branch (do not delete it)
- `-d, --delete-branch`: Override branch deletion behavior (`none`|`local`|`remote`); when omitted, uses the configured default (`local` unless overridden by `worktree.deleteBranchOnRemove`)
  - `none`: Don't delete any branches
  - `local`: Delete local branch only (default)
  - `remote`: Delete both local and remote branches
- `-j, --json`: Output in JSON format (requires --path)

**Branch Deletion:**

- By default, the local branch is deleted when removing a worktree
- Use `--keep-branch` to preserve the branch
- Before deleting, checks if branch is merged (use `--force` to skip this check)
- Remote branch deletion requires confirmation unless `--force` is used
- Use `worktree.deleteBranchOnRemove` in config to change default behavior

**Examples:**

```bash
# Interactive selection (select from list)
pando remove

# Direct removal with path (deletes local branch by default)
pando remove --path ../feature-x
pando remove --path ../feature-x --force

# Keep the branch when removing worktree
pando remove --path ../feature-x --keep-branch

# Remove worktree and delete both local and remote branches
pando remove --path ../feature-x --delete-branch remote --force

# Interactive multi-select with force flag
pando remove --force
```

### `pando clean`

Clean stale git worktrees (merged branches, gone upstream, prunable)

**Detection Categories:**

- **Merged**: Branch fully merged into main/master (or specified target branch)
- **Gone**: Remote tracking branch was deleted upstream
- **Prunable**: Worktree directory was already deleted

**Flags:**

- `--fetch`: Run `git fetch --prune` before detection to update remote tracking branch state (configurable: `clean.fetch`)
- `-f, --force`: Skip confirmation prompts and clean all stale worktrees
- `-k, --keep-branch`: Keep local branch after worktree removal (configurable: `worktree.deleteBranchOnRemove = "none"`)
- `--dry-run`: Show what would be removed without acting
- `-t, --target-branch`: Branch to check merges against (default: main or master) (configurable: `worktree.targetBranch`)
- `-j, --json`: Output in JSON format

**Examples:**

```bash
# Interactive selection of stale worktrees
pando clean

# Fetch latest and detect stale worktrees
pando clean --fetch

# See what would be cleaned without acting
pando clean --dry-run

# Clean all stale worktrees without prompts
pando clean --force

# Check merges against develop branch
pando clean --target-branch develop

# Keep branches after removing worktrees
pando clean --keep-branch

# JSON output for scripting
pando clean --json
```

### `pando reap`

Reclaim expired ephemeral worktrees without touching long-lived, locked, or dirty worktrees. A worktree is eligible after its metadata TTL (or `worktree.ephemeralTtl`, default `4h`) expires. By default its branch must also be merged into `worktree.targetBranch`; set `reap.requireMerged = false` to retain unmerged branches while removing clean worktrees.

**Flags:**

- `--dry-run`: Show eligible and safety-skipped worktrees without removing anything
- `--owner <session>`: Only consider worktrees owned by the specified session
- `-f, --force`: Skip the confirmation prompt; safety checks still apply
- `-j, --json`: Run non-interactively and emit structured results

```bash
pando reap --dry-run
pando reap --owner session-123 --force
pando reap --json
```

### `pando lock` / `pando unlock`

Lock a worktree so Git and `pando reap` leave it alone, or remove that lock. Targets may be an absolute/relative worktree path or an exact branch name; `--path` is available as an alternative to the positional target.

**Flags:**

- `-p, --path <target>`: Worktree path or branch name
- `--reason <text>`: Record a lock reason (`pando lock` only)
- `-j, --json`: Output in JSON format

```bash
pando lock ../feature-x --reason "active work"
pando lock feature/x --json
pando unlock ../feature-x
pando unlock --path feature/x --json
```

### `pando symlink`

Move a file from the current worktree to the main worktree and replace it with a symlink. Useful for keeping configuration files, dependencies, or other shared files in sync across all worktrees.

**Arguments:**

- `FILE`: File to symlink (required)

**Flags:**

- `-f, --force`: Overwrite file in main worktree if it exists
- `--dry-run`: Simulate the operation without making changes
- `-j, --json`: Output in JSON format

**Examples:**

```bash
# Move .env file to main worktree and symlink it
pando symlink .env

# Preview what would happen
pando symlink package.json --dry-run

# Overwrite existing file in main worktree
pando symlink config.json --force

# Use with JSON output
pando symlink .env --json
```

**Use Cases:**

- **Environment files** (`.env`, `.env.local`): Share environment configuration across worktrees
- **Lock files** (`package-lock.json`, `pnpm-lock.yaml`): Ensure consistent dependency resolution
- **IDE settings** (`.vscode/settings.json`): Share editor configuration
- **Build cache directories**: Avoid duplicate downloads/compilation

### `pando branch backup`

Create a timestamped backup of a branch. Backup branches are named `backup/<sourceBranch>/<timestamp>` where timestamp is UTC YYYYMMDD-HHmmss format.

**Flags:**

- `-b, --branch`: Source branch to backup (default: current branch)
- `-m, --message`: Optional message to store with the backup
- `-j, --json`: Output in JSON format

**Examples:**

```bash
# Backup the current branch
pando branch backup

# Backup with a descriptive message
pando branch backup -m "Before risky refactor"

# Backup a specific branch
pando branch backup --branch main

# Backup with JSON output for scripts
pando branch backup --branch feature/auth -m "Pre-merge backup" --json
```

**Use Cases:**

- **Before rebasing**: Create a safety net before interactive rebase
- **Before merging**: Snapshot a feature branch before merging to main
- **Experimenting**: Save current state before trying something risky
- **Checkpointing**: Regular backups during long-running work

### `pando branch restore`

Restore a branch to a previous backup state. Resets the target branch to match the commit of a selected backup branch.

**Flags:**

- `-b, --branch`: Target branch to restore (default: current branch)
- `--backup`: Backup branch to restore from (interactive selection if omitted)
- `-f, --force`: Skip confirmation prompt
- `-d, --delete-backup`: Delete the backup branch after successful restore
- `-j, --json`: Output in JSON format (requires `--backup`)

**Safety Features:**

- Checks for uncommitted changes before restoring current branch
- Prevents restoring branches checked out in other worktrees
- Shows commits that will become unreachable before confirmation
- Requires explicit `--backup` flag with `--json` (no interactive mode)

**Examples:**

```bash
# Interactive restore - select from available backups
pando branch restore

# Restore from a specific backup
pando branch restore --backup backup/main/20250117-153045

# Restore a specific branch with force (no confirmation)
pando branch restore --branch main --backup backup/main/20250117-153045 --force

# Restore and delete the backup afterward
pando branch restore --backup backup/feature/20250117-100000 -f -d

# JSON output for automation (requires explicit backup)
pando branch restore --backup backup/feature/20250117-100000 --force --json
```

**Use Cases:**

- **Undo a rebase**: Restore to pre-rebase state if conflicts are too complex
- **Recover from mistakes**: Quickly get back to a known good state
- **A/B testing approaches**: Restore and try a different implementation

## Configuration

Pando supports flexible configuration through multiple sources with a clear priority hierarchy.

### Config Commands

#### `pando config init`

Generate a configuration file with defaults and helpful comments.

**Flags:**

- `-g, --global`: Create user-level config at `~/.config/pando/config.toml`
- `--git-root`: Create config at git repository root
- `-f, --force`: Overwrite existing config file
- `-m, --merge`: Merge missing defaults into existing config (default behavior)
- `--no-merge`: Error if config already exists
- `-j, --json`: Output in JSON format

**Examples:**

```bash
# Create project config in current directory
pando config init

# Create user-level (global) config
pando config init --global

# Create config at git repository root
pando config init --git-root

# Overwrite existing config
pando config init --force

# Add missing defaults to existing config
pando config init --merge
```

#### `pando config show`

Display the current effective configuration with source information.

**Flags:**

- `-j, --json`: Output in JSON format

**Examples:**

```bash
# Show current config with sources
pando config show

# JSON output for scripts
pando config show --json
```

### Configuration Locations

Pando discovers configuration from multiple locations:

| Location          | File                                   | Use Case                    |
| ----------------- | -------------------------------------- | --------------------------- |
| Current directory | `.pando.toml`                          | Project-specific settings   |
| Git root          | `.pando.toml`                          | Repository-wide defaults    |
| Project files     | `pyproject.toml`, `package.json`, etc. | Embedded in existing config |
| User home         | `~/.config/pando/config.toml`          | User-level defaults         |

### Configuration Priority

Settings are merged with the following priority (highest to lowest):

1. **CLI flags** - Always win (e.g., `--path`, `--no-rebase`)
2. **Environment variables** - `PANDO_*` prefixed variables
3. **Project `.pando.toml`** - In current directory or parent directories
4. **Project files** - `pyproject.toml` `[tool.pando]`, `package.json` `"pando"`, etc.
5. **Global config** - `~/.config/pando/config.toml`
6. **Built-in defaults** - Sensible defaults for all options

### Project vs User Config

**Project config** (`.pando.toml` in repo):

- Shared with team via version control
- Project-specific worktree paths and patterns
- Checked into git

**User config** (`~/.config/pando/config.toml`):

- Personal preferences across all projects
- Default behaviors you always want
- Not shared with team

```bash
# Create user-level config
pando config init --global
```

### Config File Format

Pando uses TOML format for configuration:

```toml
# Rsync Configuration
[rsync]
enabled = true
flags = ["--archive"]         # .git is always excluded automatically (do not add it here)
exclude = ["dist/", "node_modules/"]
onlyUntracked = true          # Sync only gitignored artifacts (default). false = mirror the
                              # full tree, but only when source/target share the same commit.

# Symlink Configuration
[symlink]
patterns = ["package.json", ".env*"]
relative = true
beforeRsync = true
allowTracked = true           # Symlink git-tracked paths, hidden via skip-worktree (default).
                              # false = strict mode: skip tracked patterns with a warning.

# Worktree Configuration
[worktree]
defaultPath = "../worktrees"      # Default parent directory for worktrees
rebaseOnAdd = true                # Rebase existing branches when adding worktree
deleteBranchOnRemove = "local"    # Delete branch on worktree remove: "none", "local", "remote" (default: "local")
useProjectSubfolder = false       # Nest worktrees as defaultPath/projectName/branchName (default: false)
targetBranch = "main"             # Target branch for merge checks (used by clean command)
defaultKind = "auto"              # auto, ephemeral, or long-lived
ephemeralTtl = "4h"               # Default TTL exposed to ephemeral setup hooks
autoLockActive = true              # Git-lock worktrees owned by active sessions

# Clean Configuration
[clean]
fetch = false                 # Run git fetch --prune before detection

# Post-command scripts
# Runs after a command succeeds. For pando add, scripts run from the created worktree.
[postCommands]
add = ["pnpm install"]        # Optional setup commands after pando add succeeds
```

### Post-command scripts

`postCommands` lets you configure shell commands to run after Pando completes a command successfully. The first supported hook is `add`:

```toml
[postCommands]
add = ["pnpm install", "pnpm run prepare"]
```

Scripts configured for `add` run **after** the worktree has been created and rsync/symlink setup has finished. They execute from the created worktree directory and receive useful context through environment variables:

- `PANDO_COMMAND` — command id, such as `add`
- `PANDO_WORKTREE_PATH` — absolute path to the created worktree
- `PANDO_BRANCH` — branch name, or empty in detached HEAD mode
- `PANDO_COMMIT` — created worktree commit
- `PANDO_KIND` — resolved lifecycle kind (`ephemeral` or `long-lived`)
- `PANDO_TTL` — effective TTL when defined (explicit `--ttl`, otherwise the ephemeral default)

Human-readable output shows each script, its working directory, exit status, stdout, and stderr. JSON output includes a stable `postCommands` array with `name`, `command`, `cwd`, `exitCode`, `signal`, `stdout`, `stderr`, `success`, and `duration` fields. A non-zero exit code stops later scripts and returns the existing JSON error shape with `success: false`, `error`, `postCommands`, and `failedPostCommand`.

### Post-command trust

Post-commands defined in a config file run with a shell, so a `.pando.toml`
committed in a repository you just cloned could otherwise execute arbitrary
commands the first time you run `pando add`. To prevent that, Pando uses a
**direnv-style trust gate**: the post-commands in a config file only run once you
have explicitly trusted that exact file.

How it works:

- **One-time prompt.** The first time a config file would run post-commands,
  Pando lists them and asks whether to trust the file. If you decline, the
  scripts are skipped.
- **Content-hash pinning.** Trust is recorded against the file's SHA-256 content
  hash and stored at `$XDG_CONFIG_HOME/pando/trusted-configs.json` (falling back
  to `~/.config/pando/trusted-configs.json`). The store is written with `0o600`
  permissions.
- **Re-prompt on change.** Editing the config file changes its hash and
  invalidates the trust, so you are prompted again.
- **Non-interactive / `--json` runs skip.** When there is no interactive TTY, or
  when `--json` output is requested, untrusted post-commands are **not** run; a
  warning explains how to trust them.
- **CI escape hatch.** Set `PANDO_TRUST_CONFIG=1` (or `true`) to run
  post-commands without prompting — intended for CI and automation.
- **Environment-only post-commands** (configured purely via `PANDO_*` variables,
  with no file on disk) are implicitly trusted and always run.

### Embedding in Project Files

Instead of a separate `.pando.toml`, you can embed configuration in existing project files:

**pyproject.toml** (Python projects):

```toml
[tool.pando]
[tool.pando.worktree]
defaultPath = "../worktrees"
```

**package.json** (Node.js projects):

```json
{
  "pando": {
    "worktree": {
      "defaultPath": "../worktrees"
    }
  }
}
```

**Cargo.toml** (Rust projects):

```toml
[package.metadata.pando]
[package.metadata.pando.worktree]
defaultPath = "../worktrees"
```

### Worktree Default Path

The `worktree.defaultPath` setting allows you to specify a default parent directory for worktrees:

- **Relative paths** are resolved from the git repository root
- **Absolute paths** are used as-is
- When creating a worktree with `--branch` but no `--path`, the branch name is appended to the default path
- **Branch name sanitization**: Forward slashes (`/`) in branch names are automatically converted to underscores (`_`) for filesystem safety

**Example:**

```toml
[worktree]
defaultPath = "../worktrees"
```

```bash
# Creates worktree at ../worktrees/feature-x (relative to git root)
pando add --branch feature-x

# Branch names with slashes are sanitized
pando add --branch feature/auth
# Creates: ../worktrees/feature_auth
```

### Environment Variables

All configuration options can be set via environment variables using the `PANDO_` prefix:

```bash
# Set default worktree path
export PANDO_WORKTREE_DEFAULT_PATH="../worktrees"

# Disable automatic rebase on existing branches
export PANDO_WORKTREE_REBASE_ON_ADD=false

# Delete local branch when removing worktree
export PANDO_WORKTREE_DELETE_BRANCH_ON_REMOVE=local

# Set target branch for merge checks (clean command)
export PANDO_WORKTREE_TARGET_BRANCH=main

# Always fetch before detecting stale worktrees
export PANDO_CLEAN_FETCH=true

# Now you can omit --path
pando add --branch feature-x
```

**Environment variable format:**

- Prefix: `PANDO_`
- Pattern: `PANDO_SECTION_KEY`
- Example: `PANDO_WORKTREE_DEFAULT_PATH` → `worktree.defaultPath`

Environment variables override file-based configuration but are overridden by explicit command-line flags.

**Supported variables:**

| Variable                                 | Config path                    | Type    |
| ---------------------------------------- | ------------------------------ | ------- |
| `PANDO_RSYNC_ENABLED`                    | `rsync.enabled`                | boolean |
| `PANDO_RSYNC_FLAGS`                      | `rsync.flags`                  | array   |
| `PANDO_RSYNC_EXCLUDE`                    | `rsync.exclude`                | array   |
| `PANDO_RSYNC_ONLY_UNTRACKED`             | `rsync.onlyUntracked`          | boolean |
| `PANDO_SYMLINK_PATTERNS`                 | `symlink.patterns`             | array   |
| `PANDO_SYMLINK_RELATIVE`                 | `symlink.relative`             | boolean |
| `PANDO_SYMLINK_BEFORE_RSYNC`             | `symlink.beforeRsync`          | boolean |
| `PANDO_SYMLINK_ALLOW_TRACKED`            | `symlink.allowTracked`         | boolean |
| `PANDO_WORKTREE_DEFAULT_PATH`            | `worktree.defaultPath`         | string  |
| `PANDO_WORKTREE_REBASE_ON_ADD`           | `worktree.rebaseOnAdd`         | boolean |
| `PANDO_WORKTREE_DELETE_BRANCH_ON_REMOVE` | `worktree.deleteBranchOnRemove`| string  |
| `PANDO_WORKTREE_USE_PROJECT_SUBFOLDER`   | `worktree.useProjectSubfolder` | boolean |
| `PANDO_WORKTREE_TARGET_BRANCH`           | `worktree.targetBranch`        | string  |
| `PANDO_CLEAN_FETCH`                      | `clean.fetch`                  | boolean |

- Booleans accept `true`/`false`, `1`/`0`, or `yes`/`no` (case-insensitive).
- Arrays are comma-separated, e.g. `PANDO_RSYNC_EXCLUDE=*.log,tmp/`.

`PANDO_TRUST_CONFIG` is a separate, non-config escape hatch for the
[post-command trust gate](#post-command-trust) — set it to `1` or `true` to run
post-commands from config files non-interactively (e.g. in CI). It is not part
of the merged configuration.

## Automation & JSON Output

All commands support the `--json` flag for machine-readable output:

```bash
# Use in scripts
worktrees=$(pando list --json)

# Parse with jq
pando list --json | jq '.[] | select(.branch == "feature-x")'
```

## Development

```bash
pnpm install        # Install dependencies
pnpm dev list       # Run the CLI from source (no rebuild)
pnpm validate       # Format check, lint, typecheck, and tests
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development workflow.

## Project Structure

```
pando/
├── src/
│   ├── commands/       # Command implementations
│   ├── utils/          # Shared utilities
│   └── index.ts        # Main entry point
├── test/               # Tests
├── bin/                # Executable scripts
└── dist/               # Compiled output
```

## Requirements

- Node.js >= 20.0.0 (development targets Node 20, pinned in `.node-version`)
- Git >= 2.5.0 (for worktree support)

## Troubleshooting

### Error Messages and Stack Traces

Pando uses clean error messages for expected errors (like "file already exists" or "not a git repository"). You should **not** see stack traces for these errors.

**If you see a stack trace for a validation error**, this indicates a bug - please report it!

Common error types:

- **Validation Errors**: Clean error messages without stack traces (use `--force`, missing files, invalid arguments)
- **Operation Errors**: Runtime failures with context (network errors, permission issues, git command failures)
- **Internal Errors**: Stack traces indicating bugs that should be reported

### JSON Output for Scripts

All commands support `--json` flag for machine-readable output:

```bash
# Merge missing defaults into existing config
pando config init --json
# Output: {"status":"success","action":"merged","added":[...],"addedCount":2}

# Check exit codes in scripts
pando add --path ../feature --branch feature --json
if [ $? -ne 0 ]; then
  echo "Command failed"
fi
```

### Debug Mode

For detailed debugging, run commands with Node.js debug environment:

```bash
# Enable debug output
NODE_DEBUG=pando pnpm dev list

# Or with node inspector
node --inspect bin/dev.js list
```

### Common Issues

**"Not a git repository"**

- Make sure you're running pando from within a git repository
- Check `git status` works in your current directory

**"Worktree path already exists"**

- The target path already has a directory/file
- Use a different path or remove the existing path first

**"Worktree has uncommitted changes"**

- The worktree you're trying to remove has uncommitted changes
- Commit or stash changes first, or use `--force` to remove anyway (WARNING: will lose changes)

**"rsync is not installed"**

- Install rsync for file syncing features
- macOS: `brew install rsync`
- Ubuntu/Debian: `apt install rsync`
- Or use `--skip-rsync` to disable file syncing

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup,
the development loop, quality gates, and PR expectations. For the project
structure and design rationale, read [ARCHITECTURE.md](./ARCHITECTURE.md) and
[DESIGN.md](./DESIGN.md).

## License

MIT © zpyoung

## Why "Pando"?

[Pando](<https://en.wikipedia.org/wiki/Pando_(tree)>) is a clonal colony of aspen trees that shares a single root system - much like how git worktrees share a single repository!
