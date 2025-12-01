# Pando

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

```bash
brew tap zpyoung/pando
brew install pando
```

### Using pnpm

```bash
pnpm install -g pando
```

### Using npm

```bash
npm install -g pando
```

### From source

```bash
git clone https://github.com/zpyoung/pando.git
cd pando
pnpm install
pnpm build
pnpm link
```

## Quick Start

```bash
# Create a new worktree for a feature branch
pando add --path ../feature-x --branch feature-x

# List all worktrees
pando list

# Remove a worktree (interactive selection or direct with --path)
pando remove
pando remove --path ../feature-x
```

## Commands

### `pando add`

Create a new git worktree (supports both creating new branches and checking out existing branches)

**Flags:**

- `-p, --path`: Path for the new worktree (optional if `worktree.defaultPath` is configured)
- `-b, --branch`: Branch to checkout or create
- `-c, --commit`: Commit hash to base the new branch on
- `-f, --force`: Force create branch even if it exists (uses git worktree add -B)
- `--no-rebase`: Skip automatic rebase of existing branch onto source branch
- `-j, --json`: Output in JSON format

**Automatic Rebase**: When checking out an existing branch, pando automatically rebases it onto the current branch. This keeps your feature branches up-to-date. If the rebase fails (e.g., conflicts), a warning is shown but the worktree is still created. Use `--no-rebase` to skip this behavior, or set `worktree.rebaseOnAdd = false` in config.

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
```

### `pando list`

List all git worktrees

**Flags:**

- `-v, --verbose`: Show detailed information
- `-j, --json`: Output in JSON format

**Examples:**

```bash
pando list
pando list --json
```

### `pando remove`

Remove a git worktree

**Flags:**

- `-p, --path`: Path to the worktree to remove (optional - will prompt interactively if omitted)
- `-f, --force`: Force removal even with uncommitted changes
- `-k, --keep-branch`: Keep the local branch (do not delete it)
- `-d, --delete-branch`: Delete associated branch after removing worktree (`none`|`local`|`remote`)
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

## Configuration

Pando can be configured using a `.pando.toml` file in your project root:

```toml
# Rsync Configuration
[rsync]
enabled = true
flags = ["--archive", "--exclude", ".git"]
exclude = ["dist/", "node_modules/"]

# Symlink Configuration
[symlink]
patterns = ["package.json", ".env*"]
relative = true
beforeRsync = true

# Worktree Configuration
[worktree]
defaultPath = "../worktrees"  # Default parent directory for worktrees
rebaseOnAdd = true            # Rebase existing branches when adding worktree
deleteBranchOnRemove = "none" # Delete branch on worktree remove: "none", "local", "remote"
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

# Now you can omit --path
pando add --branch feature-x
```

**Environment variable format:**

- Prefix: `PANDO_`
- Pattern: `PANDO_SECTION_KEY`
- Example: `PANDO_WORKTREE_DEFAULT_PATH` → `worktree.defaultPath`

Environment variables override file-based configuration but are overridden by explicit command-line flags.

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
# Install dependencies
pnpm install

# Run in development mode
pnpm dev list

# Build
pnpm build

# Run tests
pnpm test

# Lint & format
pnpm lint
pnpm format
```

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

- Node.js >= 18.0.0
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

Contributions are welcome! Please read [ARCHITECTURE.md](./ARCHITECTURE.md) and [DESIGN.md](./DESIGN.md) to understand the project structure and design decisions.

## License

MIT © zpyoung

## Why "Pando"?

[Pando](<https://en.wikipedia.org/wiki/Pando_(tree)>) is a clonal colony of aspen trees that shares a single root system - much like how git worktrees share a single repository!
