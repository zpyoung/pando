# Pando

> A TypeScript-based CLI for managing Git worktrees with automation-first design

Pando makes it effortless to work on multiple branches simultaneously using Git worktrees. Built for modern developer workflows, it provides both human-friendly commands and machine-readable output for CI/CD automation.

## Features

- 🌳 **Worktree Management**: Create, list, remove, and navigate git worktrees with ease
- 🔀 **Branch Operations**: Streamlined branch creation and deletion with worktree integration
- 🤖 **Automation-First**: Every command supports `--json` flag for scripting and AI agents
- 🎯 **Developer-Friendly**: Interactive prompts when flags aren't provided
- ⚡ **Fast**: Built with TypeScript for type safety and performance
- 🔧 **Extensible**: Clean architecture makes adding new commands simple

## Installation

### Using pnpm (recommended)

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
pando worktree add --path ../feature-x --branch feature-x

# List all worktrees
pando worktree list

# Navigate to a worktree (outputs path for shell evaluation)
cd $(pando worktree navigate --branch feature-x --output-path)

# Remove a worktree (interactive selection or direct with --path)
pando worktree remove
pando worktree remove --path ../feature-x

# Create a branch with a worktree in one command
pando branch create --name feature-y --worktree ../feature-y
```

## Commands

### Worktree Commands

#### `pando worktree add`

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
pando worktree add --path ../feature-x --branch feature-x

# Checkout existing branch into worktree
pando worktree add --path ../existing --branch existing-branch

# Using config default path (if worktree.defaultPath is set in .pando.toml)
pando worktree add --branch feature-x
# OR using shorthand (positional argument)
pando worktree add feature-x

# From specific commit
pando worktree add --path ../hotfix --branch hotfix --commit abc123

# Force reset existing branch to commit
pando worktree add --path ../feature --branch feature-x --commit abc123 --force
```

#### `pando worktree list`

List all git worktrees

**Flags:**

- `-v, --verbose`: Show detailed information
- `-j, --json`: Output in JSON format

**Examples:**

```bash
pando worktree list
pando worktree list --json
```

#### `pando worktree remove`

Remove a git worktree

**Flags:**

- `-p, --path`: Path to the worktree to remove (optional - will prompt interactively if omitted)
- `-f, --force`: Force removal even with uncommitted changes
- `-j, --json`: Output in JSON format (requires --path)

**Examples:**

```bash
# Interactive selection (select from list)
pando worktree remove

# Direct removal with path
pando worktree remove --path ../feature-x
pando worktree remove --path ../feature-x --force

# Interactive multi-select with force flag
pando worktree remove --force
```

#### `pando worktree navigate`

Navigate to a git worktree

**Flags:**

- `-b, --branch`: Branch name to navigate to
- `-p, --path`: Worktree path to navigate to
- `--output-path`: Output only the path (for shell evaluation)
- `-j, --json`: Output in JSON format

**Examples:**

```bash
pando worktree navigate --branch feature-x
cd $(pando worktree navigate --branch feature-x --output-path)
```

### Branch Commands

#### `pando branch create`

Create a new git branch

**Flags:**

- `-n, --name` (required): Name of the branch to create
- `-f, --from`: Base branch or commit (default: main)
- `-w, --worktree`: Automatically create a worktree at this path
- `-j, --json`: Output in JSON format

**Examples:**

```bash
pando branch create --name feature-x
pando branch create --name feature-x --worktree ../feature-x
```

#### `pando branch delete`

Delete a git branch

**Flags:**

- `-n, --name` (required): Name of the branch to delete
- `-f, --force`: Force deletion even if not fully merged
- `-w, --remove-worktree`: Also remove associated worktree
- `-j, --json`: Output in JSON format

**Examples:**

```bash
pando branch delete --name feature-x
pando branch delete --name feature-x --remove-worktree
```

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
pando worktree add --branch feature-x

# Branch names with slashes are sanitized
pando worktree add --branch feature/auth
# Creates: ../worktrees/feature_auth
```

### Environment Variables

All configuration options can be set via environment variables using the `PANDO_` prefix:

```bash
# Set default worktree path
export PANDO_WORKTREE_DEFAULT_PATH="../worktrees"

# Disable automatic rebase on existing branches
export PANDO_WORKTREE_REBASE_ON_ADD=false

# Now you can omit --path
pando worktree add --branch feature-x
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
worktrees=$(pando worktree list --json)

# Parse with jq
pando worktree list --json | jq '.[] | select(.branch == "feature-x")'
```

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev worktree list

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
# Get structured error output
pando config init --json
# Output: {"status":"error","error":"Configuration file already exists..."}

# Check exit codes in scripts
pando worktree add --path ../feature --branch feature --json
if [ $? -ne 0 ]; then
  echo "Command failed"
fi
```

### Debug Mode

For detailed debugging, run commands with Node.js debug environment:

```bash
# Enable debug output
NODE_DEBUG=pando pnpm dev worktree list

# Or with node inspector
node --inspect bin/dev.js worktree list
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
