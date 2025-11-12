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
pando worktree:add --path ../feature-x --branch feature-x

# List all worktrees
pando worktree:list

# Navigate to a worktree (outputs path for shell evaluation)
cd $(pando worktree:navigate --branch feature-x --output-path)

# Remove a worktree
pando worktree:remove --path ../feature-x

# Create a branch with a worktree in one command
pando branch:create --name feature-y --worktree ../feature-y
```

## Commands

### Worktree Commands

#### `pando worktree:add`
Create a new git worktree

**Flags:**
- `-p, --path` (required): Path for the new worktree
- `-b, --branch`: Branch to checkout or create
- `-c, --commit`: Commit hash to base the new branch on
- `-j, --json`: Output in JSON format

**Examples:**
```bash
pando worktree:add --path ../feature-x --branch feature-x
pando worktree:add --path ../hotfix --branch hotfix --commit abc123
```

#### `pando worktree:list`
List all git worktrees

**Flags:**
- `-v, --verbose`: Show detailed information
- `-j, --json`: Output in JSON format

**Examples:**
```bash
pando worktree:list
pando worktree:list --json
```

#### `pando worktree:remove`
Remove a git worktree

**Flags:**
- `-p, --path` (required): Path to the worktree to remove
- `-f, --force`: Force removal even with uncommitted changes
- `-j, --json`: Output in JSON format

**Examples:**
```bash
pando worktree:remove --path ../feature-x
pando worktree:remove --path ../feature-x --force
```

#### `pando worktree:navigate`
Navigate to a git worktree

**Flags:**
- `-b, --branch`: Branch name to navigate to
- `-p, --path`: Worktree path to navigate to
- `--output-path`: Output only the path (for shell evaluation)
- `-j, --json`: Output in JSON format

**Examples:**
```bash
pando worktree:navigate --branch feature-x
cd $(pando worktree:navigate --branch feature-x --output-path)
```

### Branch Commands

#### `pando branch:create`
Create a new git branch

**Flags:**
- `-n, --name` (required): Name of the branch to create
- `-f, --from`: Base branch or commit (default: main)
- `-w, --worktree`: Automatically create a worktree at this path
- `-j, --json`: Output in JSON format

**Examples:**
```bash
pando branch:create --name feature-x
pando branch:create --name feature-x --worktree ../feature-x
```

#### `pando branch:delete`
Delete a git branch

**Flags:**
- `-n, --name` (required): Name of the branch to delete
- `-f, --force`: Force deletion even if not fully merged
- `-w, --remove-worktree`: Also remove associated worktree
- `-j, --json`: Output in JSON format

**Examples:**
```bash
pando branch:delete --name feature-x
pando branch:delete --name feature-x --remove-worktree
```

## Automation & JSON Output

All commands support the `--json` flag for machine-readable output:

```bash
# Use in scripts
worktrees=$(pando worktree:list --json)

# Parse with jq
pando worktree:list --json | jq '.[] | select(.branch == "feature-x")'
```

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev worktree:list

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

## Contributing

Contributions are welcome! Please read [ARCHITECTURE.md](./ARCHITECTURE.md) and [DESIGN.md](./DESIGN.md) to understand the project structure and design decisions.

## License

MIT © zpyoung

## Why "Pando"?

[Pando](https://en.wikipedia.org/wiki/Pando_(tree)) is a clonal colony of aspen trees that shares a single root system - much like how git worktrees share a single repository!
