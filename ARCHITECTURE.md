# Pando Architecture

This document describes the technical architecture, design patterns, and technical decisions for the Pando CLI project.

## Overview

Pando is built on a **modular, command-oriented architecture** using the oclif framework. The design emphasizes:

- **Separation of concerns**: Commands, business logic, and git operations are clearly separated
- **Type safety**: Strict TypeScript throughout
- **Testability**: Each layer is independently testable
- **Extensibility**: New commands can be added with minimal effort
- **AI-friendly**: Clear structure, focused files, predictable patterns

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **CLI Framework** | [oclif](https://oclif.io) v4 | Command parsing, help generation, plugin system |
| **Language** | TypeScript 5.5+ | Type safety, modern JavaScript features |
| **Git Operations** | [simple-git](https://github.com/steveukx/git-js) v3 | Promise-based Git wrapper |
| **User Interface** | chalk, ora, inquirer | Terminal colors, spinners, interactive prompts |
| **Testing** | Vitest + @oclif/test | Fast unit tests, CLI integration tests |
| **Build** | TypeScript compiler + ts-node | Production builds and fast dev iteration |

## Architecture Layers

### 1. Command Layer (`src/commands/`)

**Purpose**: Entry points for CLI operations

Each command:
- Extends `@oclif/core Command` class
- Defines flags using `@oclif/core Flags`
- Validates inputs
- Delegates to utility layer for business logic
- Formats and outputs results

**Structure**:
```
commands/
├── add.ts         # pando add (create worktree)
├── list.ts        # pando list (list worktrees)
├── remove.ts      # pando remove (remove worktree)
├── symlink.ts     # pando symlink (create symlinks)
└── config/
    ├── init.ts    # pando config init
    └── show.ts    # pando config show
```

**Design Pattern**: **Command Pattern**
- Each file represents one executable command
- Commands are self-contained and independently testable
- Follows oclif conventions for discovery and help generation

### 2. Utility Layer (`src/utils/`)

**Purpose**: Business logic and Git abstractions

**Key Components**:

#### `GitHelper` Class (`src/utils/git.ts`)
Wraps simple-git with domain-specific operations:

```typescript
class GitHelper {
  // Repository validation
  isRepository(): Promise<boolean>

  // Worktree operations
  addWorktree(path, options): Promise<WorktreeInfo>
  listWorktrees(): Promise<WorktreeInfo[]>
  removeWorktree(path, force): Promise<void>
  findWorktreeByBranch(name): Promise<WorktreeInfo | null>

  // Branch operations
  createBranch(name, startPoint): Promise<BranchInfo>
  deleteBranch(name, force): Promise<void>
  listBranches(): Promise<BranchInfo[]>
  branchExists(name): Promise<boolean>
  isBranchMerged(name, target): Promise<boolean>
  getCurrentBranch(): Promise<string>
}
```

**Design Pattern**: **Facade Pattern**
- Provides simplified interface to complex git operations
- Handles error transformation and type safety
- Encapsulates simple-git implementation details

### 3. Type Definitions

**Purpose**: Strong typing for all data structures

Key types:
```typescript
interface WorktreeInfo {
  path: string
  branch: string | null
  commit: string
  isPrunable: boolean
}

interface BranchInfo {
  name: string
  current: boolean
  commit: string
  label: string
}
```

### 4. Entry Points

#### Production (`bin/run.js`)
```javascript
import { execute } from '@oclif/core'
await execute({ development: false, dir: import.meta.url })
```
- Executes compiled JavaScript from `dist/`
- Used when installed globally or in production

#### Development (`bin/dev.js`)
```javascript
import { execute } from '@oclif/core'
await execute({ development: true, dir: import.meta.url })
```
- Executes TypeScript source directly via ts-node
- Faster iteration during development

## Module Organization

### Vertical Slice Architecture

Pando follows **feature-based organization** (vertical slices):

```
Feature: Worktree Management
├── Commands:    src/commands/*.ts (add, list, remove, symlink)
├── Logic:       src/utils/git.ts (worktree methods)
├── Types:       WorktreeInfo, etc.
└── Tests:       test/commands/*.test.ts
```

**Benefits**:
- Related code stays together
- Easier to reason about features
- Reduces coupling between features
- Simplifies adding new features

### Dependency Flow

```
Commands ──→ GitHelper ──→ simple-git ──→ Git CLI
   ↓            ↓
  Flags       Types
```

**Rules**:
- Commands depend on utils, never vice versa
- Utils are pure business logic (no CLI concerns)
- No circular dependencies

## Command Lifecycle

1. **Parse**: oclif parses args/flags
2. **Validate**: Command validates required inputs
3. **Execute**: Command calls GitHelper methods
4. **Format**: Command formats output (text or JSON)
5. **Output**: Command logs to stdout/stderr

```
User Input → oclif → Command.run() → GitHelper → simple-git → git
                ↓                                              ↑
              Output ←────────────────────────────────────────┘
```

## Error Handling Strategy

### Layers

1. **Git Layer** (simple-git)
   - Throws on git command failures
   - Raw error messages from git

2. **Utility Layer** (GitHelper)
   - Catches git errors
   - Transforms to domain-specific errors
   - Adds context (e.g., "Worktree not found")

3. **Command Layer**
   - Catches utility errors
   - Formats user-friendly messages
   - Uses `this.error()` for oclif error handling

### Example Flow

```typescript
// Command
try {
  await gitHelper.addWorktree(path, { branch })
} catch (error) {
  this.error(`Failed to add worktree: ${error.message}`)
}

// GitHelper
async addWorktree(path, options) {
  try {
    await this.git.raw(['worktree', 'add', ...])
  } catch (error) {
    throw new WorktreeError(`Cannot add worktree at ${path}`, error)
  }
}
```

## Testing Strategy

### Unit Tests
- Test GitHelper methods with mocked simple-git
- Fast, isolated tests for business logic

### Integration Tests
- Test commands with @oclif/test
- Validate flag parsing, help output
- Can use temporary git repositories

### Test Structure
```
test/
├── commands/        # Command integration tests
├── utils/           # Utility unit tests
└── helpers/         # Test utilities and mocks
```

## Extension Points

### Adding New Commands

1. Create file in `src/commands/topic/name.ts`
2. Extend `Command` and define flags
3. Implement `run()` method
4. Add tests in `test/commands/topic/name.test.ts`

oclif automatically discovers and registers the command.

### Adding New Git Operations

1. Add method to `GitHelper` class
2. Define return types as needed
3. Add unit tests in `test/utils/git.test.ts`
4. Use in command layer

### Adding Output Formats

Commands support `--json` flag. To add new formats:

1. Add flag definition to command
2. Check flag in `run()` method
3. Format output accordingly

## Configuration

### oclif Configuration (`package.json`)

```json
{
  "oclif": {
    "bin": "pando",
    "dirname": "pando",
    "commands": "./dist/commands",
    "topicSeparator": ":",
    "topics": {
      "config": { "description": "Manage pando configuration" }
    }
  }
}
```

### TypeScript Configuration (`tsconfig.json`)

- **Strict mode**: Enabled for maximum type safety
- **Target**: ES2022 (modern Node.js features)
- **Module**: Node16 (native ESM support)
- **Path aliases**: `@/*` maps to `./src/*`

## Performance Considerations

1. **Git Operations**: Minimal git calls, batch when possible
2. **Async/Await**: All I/O is non-blocking
3. **Lazy Loading**: Commands loaded on-demand by oclif
4. **Type Checking**: Development only (runtime uses compiled JS)

## Security Considerations

1. **Path Traversal**: Validate all path inputs
2. **Command Injection**: simple-git handles escaping
3. **Sensitive Data**: Never log full git objects (may contain secrets)
4. **Force Operations**: Require explicit flags with warnings

## Future Enhancements

### Planned Features
- Fuzzy matching for branch/worktree names
- Editor integration helpers (VSCode, etc.)
- Remote repository operations
- Worktree templates
- Custom hooks/plugins

### Architectural Changes
- Plugin system for custom commands
- Configuration file support (.pandorc)
- Telemetry/analytics (opt-in)
- Interactive TUI mode

## References

- [oclif Documentation](https://oclif.io/docs/introduction)
- [simple-git Documentation](https://github.com/steveukx/git-js)
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

For design rationale and decisions, see [DESIGN.md](./DESIGN.md).
For usage instructions, see [README.md](./README.md).
