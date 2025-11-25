# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Planned

- Interactive worktree creation wizard
- Worktree templates
- Git hooks integration
- Worktree status command
