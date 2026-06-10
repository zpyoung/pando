# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`pando health`** — new command that reports the status of every worktree
  (`clean`, `uncommitted`, `behind`, `gone`, `detached`, `error`) with a summary
  and `--json` output.
- **`pando clean`** — remove stale worktrees (merged branches, gone upstream,
  prunable directories) with `--fetch`, `--dry-run`, `--force`, `--keep-branch`,
  and `--target-branch` flags.
- **`pando branch backup` / `pando branch restore`** — create and restore
  timestamped backup branches (`backup/<branch>/<YYYYMMDD-HHmmss>`), with
  interactive selection, optional messages, and `--json` support.
- **Post-command scripts** — configure shell commands under `[postCommands]`
  (currently the `add` hook) that run after a command succeeds, with worktree
  context passed via `PANDO_COMMAND`, `PANDO_WORKTREE_PATH`, `PANDO_BRANCH`, and
  `PANDO_COMMIT` environment variables.
- **`pando add --details`** — emit detailed setup output (rsync totals, sample
  symlink paths) in both human-readable and `--json` forms.
- **`worktree.useProjectSubfolder`** config option (env:
  `PANDO_WORKTREE_USE_PROJECT_SUBFOLDER`) to nest worktrees as
  `defaultPath/projectName/branchName`.
- **`worktree.targetBranch`** config option (env:
  `PANDO_WORKTREE_TARGET_BRANCH`) and **`clean.fetch`** (env:
  `PANDO_CLEAN_FETCH`) for the clean command.
- macOS unit-test CI job (Node 20) alongside the Linux Node 18/20/22 matrix,
  Dependabot for npm and GitHub Actions, and enforced coverage thresholds.

### Changed

- Default rsync flags are now `["--archive"]`. `.git` is always excluded
  automatically by Pando (in `fileOps.buildArgs`) and must no longer be listed
  in the flags.
- Release workflow hardened: least-privilege `permissions`, npm publish with
  provenance (`id-token: write`), and `pnpm install --frozen-lockfile`
  throughout.

### Fixed

- **`pando health`** behind-upstream detection now counts commits in the correct
  direction, surfaces remote-check failures as `error` instead of silently
  reporting `clean`, and reports detached-HEAD worktrees as `detached`.
- **`pando remove --path`** now refuses to remove the main worktree (the
  repository root); only linked worktrees can be removed.
- Malformed configuration files now produce a clear error pointing at
  `pando config show` rather than crashing.
- **`pando remove --json`** no longer emits a spurious second JSON object
  (`EEXIT`) after the real error payload; oclif exit signals are now detected
  via a shared `isOclifExitError()` helper used across commands.

### Security

- **Post-command trust gate (direnv-style).** Post-commands defined in a config
  file execute with a shell, so a `.pando.toml` from a freshly cloned repo could
  otherwise run arbitrary commands on `pando add`. Such scripts now require a
  one-time interactive trust per config file, keyed to the file's content hash;
  editing the file re-triggers the prompt. The trust store lives at
  `$XDG_CONFIG_HOME/pando/trusted-configs.json` (falling back to
  `~/.config/pando/trusted-configs.json`).

  **Migration note:** post-commands sourced from a config file now require
  one-time interactive trust. Non-interactive runs (no TTY) and `--json` runs
  **skip** untrusted post-commands and emit a warning. In CI or automation, set
  `PANDO_TRUST_CONFIG=1` to allow them. Post-commands sourced purely from
  environment variables are unaffected.
- Branch names are validated up front against the core `git check-ref-format`
  rules, rejecting obviously-invalid names with a clear reason.
- rsync flags from config are filtered through a transport/exec-class denylist
  (`--rsh`, `--rsync-path`, `--remote-option`, and short `-e`/`-M`, including
  attached and bundled forms), removing a latent remote-code-execution surface.
  Matching is case-sensitive.
- Interrupting `pando add` with Ctrl+C (SIGINT) mid-setup now triggers the same
  transactional rollback as a thrown error, so an interruption no longer leaves
  a partial worktree behind.
- The trust store is written atomically with `0o600` permissions.

## [0.1.0] - 2024-11-25

Initial beta release.

### Added

- **Core Commands**
  - `pando add` - Create new git worktrees with branch creation or checkout
  - `pando list` - List all git worktrees with optional verbose output
  - `pando remove` - Remove worktrees with interactive selection or direct path
  - `pando navigate` (alias: `nav`) - Navigate to worktrees by branch or path
  - `pando symlink` - Move files to main worktree and replace with symlinks

- **Configuration System**
  - `pando config init` - Initialize configuration file with sensible defaults
  - `pando config show` - Display current configuration with source tracking
  - Support for `.pando.toml`, `pyproject.toml`, `Cargo.toml`, `package.json`, `deno.json`, `composer.json`
  - Environment variable configuration (`PANDO_*` prefix)
  - Configuration priority: CLI flags > env vars > local files > global config > defaults

- **Worktree Setup Features**
  - Rsync support for copying files from main worktree (configurable flags and excludes)
  - Symlink support for shared files (patterns, relative/absolute paths)
  - Transactional operations with automatic rollback on failure
  - Progress reporting through setup phases

- **Automation Support**
  - `--json` flag on all commands for machine-readable output
  - Clean error messages for validation failures (no stack traces)
  - Contextual error messages for operation failures
  - Exit codes suitable for scripting

- **Branch Management**
  - Automatic rebase of existing branches when adding worktrees (`--no-rebase` to skip)
  - Optional branch deletion on worktree removal (`--delete-branch local|remote`)
  - Force branch reset with `-f/--force` flag
  - Branch name sanitization for filesystem safety

### Technical

- Built with TypeScript for type safety
- Uses oclif v4 CLI framework
- simple-git for git operations
- Comprehensive test suite (356 tests)
- Clean architecture with separation of commands, utilities, and configuration

### Documentation

- README with command reference and examples
- ARCHITECTURE.md for system design
- DESIGN.md files for module-level documentation
- CLAUDE.md for AI assistant context
