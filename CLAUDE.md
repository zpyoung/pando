# Claude Code Context for Pando

This file provides AI assistants with project-specific context, patterns, and guidelines for working with the Pando codebase.

## Project Overview

**Pando** is a TypeScript CLI for managing Git worktrees. It uses oclif for command handling, simple-git for git operations, and follows strict TypeScript patterns with an automation-first design philosophy.

## Quick Reference

### Project Commands

```bash
pnpm install       # Install dependencies
pnpm build         # Compile TypeScript
pnpm dev <cmd>     # Run command in dev mode
pnpm test          # Run tests
pnpm lint          # Lint code
pnpm format        # Format code
```

### Beads Commands (Task Management)

```bash
bd ready --json           # Find ready work (no blockers)
bd list --json            # List all issues
bd show <id> --json       # Show issue details
bd create "title" --json  # Create new issue
bd update <id> --status in_progress  # Claim task
bd comments add <id> "text"          # Add progress comment
bd close <id> --reason "Done"        # Complete task
bd sync                   # Sync with git (run at session end)
```

**Database Location**: `.beads/pando.db` (SQLite, gitignored)
**Issue Prefix**: `pando-` (e.g., `pando-1`, `pando-2`)
**Versioned State**: `.beads/issues.jsonl` (committed to git)

### Key Directories

- `src/commands/` - Command implementations (CLI layer)
- `src/utils/` - Business logic and git operations
- `test/` - Test files (mirrors src structure)
- `bin/` - Executable entry points
- `dist/` - Compiled output (gitignored)

## Architecture Patterns

### Command Pattern

Each command is a self-contained class in `src/commands/topic/verb.ts`:

```typescript
import { Command, Flags } from '@oclif/core'

export default class VerbTopic extends Command {
  static description = 'Clear description of what this does'

  static examples = ['<%= config.bin %> <%= command.id %> --required-flag value']

  static flags = {
    requiredFlag: Flags.string({
      char: 'r',
      description: 'What this flag does',
      required: true,
    }),
    json: Flags.boolean({
      char: 'j',
      description: 'Output in JSON format',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(VerbTopic)

    // Implementation here
    // 1. Validate inputs
    // 2. Call GitHelper methods
    // 3. Format output based on --json flag
  }
}
```

### Utility Pattern

Business logic lives in `src/utils/git.ts` as methods on the `GitHelper` class:

```typescript
export class GitHelper {
  async operationName(params: Type): Promise<ReturnType> {
    // 1. Use this.git (simple-git instance)
    // 2. Handle errors
    // 3. Return typed results
    throw new Error('Not implemented')
  }
}
```

### Test Pattern

Tests use Vitest and mirror the source structure:

```typescript
import { describe, it, expect } from 'vitest'

describe('command-name', () => {
  it('should describe expected behavior', () => {
    // TODO: Implement test
    expect(true).toBe(true) // Placeholder
  })
})
```

### Error Handling Pattern

All commands use the centralized `ErrorHelper` utility from `src/utils/errors.ts` for consistent error handling with proper JSON support:

```typescript
import { ErrorHelper } from '../../utils/errors.js'

// 1. VALIDATION ERRORS (expected user errors)
// Use for: file exists, invalid arguments, missing requirements
if ((await fs.pathExists(path)) && !flags.force) {
  ErrorHelper.validation(this, 'File already exists. Use --force to overwrite.', flags.json)
}

// 2. OPERATION ERRORS (runtime failures)
// Use for: network errors, permission issues, external command failures
try {
  await gitHelper.operation()
} catch (error) {
  ErrorHelper.operation(this, error as Error, 'Failed to execute operation', flags.json)
}

// 3. UNEXPECTED ERRORS (internal bugs)
// Use for: missing initialization, invalid state, should-never-happen
if (!chalk) {
  ErrorHelper.unexpected(this, new Error('Chalk not initialized - this is a bug'))
}

// 4. WARNINGS (non-fatal issues)
// Use for: deprecated features, ignored config, potential issues
ErrorHelper.warn(this, 'This feature is deprecated. Use --new-feature instead.', flags.json)
```

**Key Differences:**

- `validation()` - Clean errors without stack traces (expected)
- `operation()` - Contextual errors for runtime failures
- `unexpected()` - Shows stack traces for debugging bugs
- `warn()` - Non-fatal warnings, doesn't exit

**JSON Support:**
All error methods automatically support `--json` flag:

- Validation errors: `{ status: 'error', error: 'message' }`
- Operation errors: `{ status: 'error', error: 'message', context: '...', details: '...' }`
- Warnings: `{ status: 'warning', warning: 'message' }`

## Coding Conventions

### TypeScript Style

1. **Strict Types**: No `any`, always explicit types
2. **Async/Await**: All I/O uses promises
3. **Interfaces for Data**: Use interfaces for data structures

```typescript
// Good
interface WorktreeInfo {
  path: string
  branch: string | null
  commit: string
  isPrunable: boolean
}

async function getWorktrees(): Promise<WorktreeInfo[]> {
  // ...
}

// Avoid
function getWorktrees(): any {
  // ...
}
```

### Naming Conventions

- **Commands**: `VerbNoun` (e.g., `AddWorktree`, `ListBranch`)
- **Files**: `kebab-case.ts` (e.g., `add.ts`, `git-helper.ts`)
- **Variables**: `camelCase`
- **Types/Interfaces**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`

### File Organization

```
src/commands/topic/verb.ts     # Command implementation
   ├─ imports
   ├─ class definition
   │  ├─ static description
   │  ├─ static examples
   │  ├─ static flags
   │  └─ async run() method
   └─ exports
```

Keep files under 250 lines. If longer, extract utilities.

## Common Tasks

### Adding a New Command

1. **Create command file**:

   ```bash
   touch src/commands/topic/verb.ts
   ```

2. **Implement command** (follow Command Pattern above)

3. **Create test file**:

   ```bash
   touch test/commands/topic/verb.test.ts
   ```

4. **Add examples to README.md**

5. **Run and verify**:
   ```bash
   pnpm dev topic:verb --help
   ```

### Adding Git Operations

1. **Add method to GitHelper** in `src/utils/git.ts`:

   ```typescript
   async newOperation(params: Type): Promise<ResultType> {
     // Implementation with TODOs
     throw new Error('Not implemented')
   }
   ```

2. **Add tests** in `test/utils/git.test.ts`

3. **Use in command layer**

### Implementing TODOs

Look for `// TODO:` comments in stub files. Each TODO includes:

- What needs to be done
- Step-by-step implementation hints
- Expected behavior

Example:

```typescript
// TODO: Implement worktree add logic
// 1. Validate the repository is a git repo
// 2. Check if path already exists
// 3. Validate branch/commit if provided
// 4. Execute git worktree add command
// 5. Handle errors appropriately
// 6. Format output based on --json flag
```

## Documentation Maintenance

### CRITICAL: Automatic Documentation Updates

**AI assistants MUST automatically keep documentation files synchronized with code changes.**

### Documentation File Types

#### 1. CLAUDE.md (Project Root Only)

**Purpose**: AI assistant context and project-specific guidelines

**Location**: Project root (`/CLAUDE.md`)

**Update When**:

- Project patterns or conventions change
- New common tasks are established
- Dependencies are added or removed
- Project status or phase changes
- New workflows or development practices are adopted

**Contents**:

- Project overview and quick reference
- Architecture patterns and coding conventions
- Common tasks and workflows
- Testing guidelines
- Git workflow
- Dependencies
- Project status
- Resources and references

### AI Workflow (Spec-Driven Development)

We follow a **Spec-Driven Development (SDD)** workflow to ensure AI agents have clear context.

#### 1. Core Context Files (`ai-docs/`)

- **`SPEC.md`**: High-level goals and user stories. **Start here.**
- **`PLAN.md`**: Technical architecture and implementation plan.
- **`TASKS.md`**: Atomic checklist of tasks.
- **`CONTEXT.md`**: Domain glossary and constraints.
- **`LESSONS.md`**: Feedback loop (patterns to keep/avoid).

#### 2. Workflow Steps

1. **Update Specs**: Before writing code, update `SPEC.md` and `PLAN.md`.
2. **Define Tasks**: Break down work into `TASKS.md`.
3. **Implement**: Execute tasks one by one.
4. **Validate**: Run `pnpm ai:validate` to ensure docs are in sync.
5. **Update Context**: Run `pnpm ai:context` to refresh `llm.txt`.

#### 3. Automation

- `pnpm ai:context`: Generates `llm.txt` (full project context).
- `pnpm ai:validate`: Checks for missing `DESIGN.md` files.

#### 2. ARCHITECTURE.md (Major/Important Folders)

**Purpose**: High-level architectural decisions and system design

**Placement Rules**:

- **Always** in project root
- In **major feature directories** (e.g., `src/plugins/`, `src/core/`)
- In **significant subsystems** with multiple components
- When a folder contains 5+ files or 3+ subdirectories
- When introducing a new architectural pattern

**Do NOT create in**:

- Test directories
- Single-file directories
- Utility folders with simple helpers
- Build/config directories

**Update When**:

- Adding new architectural layers or patterns
- Changing module dependencies
- Adding new major features or subsystems
- Refactoring system boundaries
- Changing technology stack
- Modifying data flow or execution patterns

**Contents**:

```markdown
# [Module/Feature] Architecture

## Overview

High-level description of the module/subsystem

## Components

Major components and their responsibilities

## Architecture Pattern

What pattern is used (layered, plugin, event-driven, etc.)

## Dependencies

What this module depends on and what depends on it

## Data Flow

How data moves through the system

## Extension Points

How to extend or modify this architecture

## Design Decisions

Key architectural choices and rationale
```

#### 3. DESIGN.md (Most Individual Folders)

**Purpose**: Lower-level design decisions and implementation details

**Placement Rules**:

- In **feature directories** (e.g., `src/commands/worktree/`)
- In **utility directories** (e.g., `src/utils/`)
- In **any folder with 2+ implementation files**
- When a folder represents a cohesive feature or concern

**Do NOT create in**:

- Test directories (tests document themselves)
- Folders with only types/interfaces
- Folders with single utility files
- Parent folders that only contain subdirectories

**Update When**:

- Adding new files to the folder
- Changing implementation approach
- Adding new patterns or utilities
- Refactoring existing code
- Adding new dependencies or integrations

**Contents**:

```markdown
# [Feature/Module] Design

## Purpose

What this module does and why it exists

## Files Overview

Brief description of each file in this directory

## Key Design Decisions

- Why this approach was chosen
- Trade-offs considered
- Alternative approaches rejected

## Patterns Used

Specific patterns or techniques used in this module

## Dependencies

Libraries or modules this depends on

## Usage Examples

How to use the main exports from this module

## Future Considerations

Potential improvements or extensions
```

#### 4. README.md

**Purpose**: User-facing documentation

**Location**: Project root (and optionally in major subdirectories)

**Update When**:

- Adding new commands or features
- Changing command flags or behavior
- Adding new installation methods
- Changing requirements
- Adding new examples or use cases

**Contents**:

- Project description
- Installation instructions
- Quick start guide
- Command reference
- Examples
- Contributing guidelines

### Automatic Update Workflow

When making code changes, AI assistants MUST follow this workflow:

#### Step 1: Identify Affected Documentation

```
Code Change → Check:
├─ Does this change affect user-facing behavior? → Update README.md
├─ Does this change affect architecture? → Update relevant ARCHITECTURE.md
├─ Does this add/modify a module? → Update/Create DESIGN.md in that folder
└─ Does this change project patterns? → Update CLAUDE.md
```

#### Step 2: Update Documentation Files

**Do this automatically WITHOUT asking the user**

```typescript
// Example: Adding a new command
// 1. Create src/commands/new/command.ts
// 2. Automatically update:
//    - README.md: Add command to reference section
//    - src/commands/new/DESIGN.md: Create if doesn't exist
//    - src/commands/ARCHITECTURE.md: Update if pattern changes
//    - CLAUDE.md: Update if new patterns introduced
```

#### Step 3: Commit Documentation with Code

**Include documentation updates in the same commit**

```bash
# Good commit
git add src/commands/worktree/sync.ts
git add src/commands/worktree/DESIGN.md
git add README.md
git commit -m "feat(worktree): add sync command

- Implement worktree sync for syncing with remote
- Update DESIGN.md with sync implementation details
- Add command to README.md reference"
```

### Documentation Update Examples

#### Example 1: Adding a New Command

**Code Change**: Create `src/commands/worktree/sync.ts`

**Required Documentation Updates**:

1. **README.md**: Add command to reference section with examples
2. **src/commands/worktree/DESIGN.md**: Add description of sync command
3. **CLAUDE.md**: Update if new patterns are introduced (e.g., new git operation)

#### Example 2: Adding a New Utility Module

**Code Change**: Create `src/utils/config.ts` for configuration management

**Required Documentation Updates**:

1. **src/utils/DESIGN.md**: Create or update with config utility details
2. **ARCHITECTURE.md** (root): Update "Utility Layer" section
3. **CLAUDE.md**: Add to "Common Patterns" if it's a new pattern

#### Example 3: Refactoring Architecture

**Code Change**: Split GitHelper into separate classes per concern

**Required Documentation Updates**:

1. **ARCHITECTURE.md** (root): Update architecture layers and patterns
2. **src/utils/DESIGN.md**: Update with new structure
3. **CLAUDE.md**: Update patterns and common tasks
4. **README.md**: Update if usage examples change

### Documentation Structure Guidelines

#### ARCHITECTURE.md Structure

```markdown
# [Name] Architecture

## Overview

2-3 paragraphs: What is this, why it exists, high-level approach

## Technology Stack

Table or list of technologies and their purposes

## Architecture Layers/Components

Detailed breakdown of major components

## Module Organization

How code is organized (vertical slice, layered, etc.)

## Key Patterns

Design patterns used (Command, Factory, etc.)

## Data Flow

How data moves through the system

## Extension Points

How to add new features or modify behavior

## Design Decisions

Major decisions and their rationale
```

#### DESIGN.md Structure

```markdown
# [Name] Design

## Purpose

1-2 paragraphs: What this does and why

## Files in This Module

- file1.ts - Description
- file2.ts - Description

## Implementation Approach

Why this approach over alternatives

## Key Functions/Classes

Brief description of main exports

## Dependencies

What this module uses

## Usage

Code examples of common usage

## Testing Approach

How this module is tested

## Future Improvements

Potential enhancements
```

### When to Create New Documentation Files

#### Create ARCHITECTURE.md when:

- [ ] Creating a new major directory (src/plugins/, src/integrations/)
- [ ] Directory has 5+ files or 3+ subdirectories
- [ ] Introducing a new architectural pattern
- [ ] Creating a subsystem with multiple interacting components

#### Create DESIGN.md when:

- [ ] Creating a feature directory with 2+ files
- [ ] Adding utility modules that others will use
- [ ] Implementing a complex algorithm or pattern
- [ ] Creating reusable components

#### Update README.md when:

- [ ] Adding user-facing commands
- [ ] Changing installation or setup
- [ ] Adding new features or capabilities
- [ ] Changing CLI behavior

#### Update CLAUDE.md when:

- [ ] Establishing new coding patterns
- [ ] Adding common tasks or workflows
- [ ] Changing project structure significantly
- [ ] Adding dependencies or tools

### Documentation Quality Standards

#### All documentation files MUST:

- Use clear, concise language
- Include code examples where relevant
- Be kept synchronized with code
- Follow markdown best practices
- Use consistent formatting
- Be up-to-date (no stale information)

#### ARCHITECTURE.md files MUST:

- Explain high-level structure and patterns
- Show component relationships
- Document key design decisions
- Explain extension points

#### DESIGN.md files MUST:

- Describe implementation details
- List all files in the directory
- Explain design choices
- Provide usage examples

### Enforcement

**AI assistants MUST**:

- Check for missing documentation files when creating new directories
- Update affected documentation files automatically when making code changes
- Create DESIGN.md files for new feature directories
- Create ARCHITECTURE.md files for new major subsystems
- Never ask the user "should I update documentation?" - just do it

**AI assistants SHOULD**:

- Suggest documentation improvements when reading outdated files
- Flag inconsistencies between code and documentation
- Offer to create missing documentation files proactively

## Testing Guidelines

### Unit Tests (Utilities)

Test `GitHelper` methods with mocked `simple-git`:

```typescript
describe('GitHelper', () => {
  it('should add worktree', async () => {
    // Mock git operations
    // Call method
    // Assert results
  })
})
```

### Integration Tests (Commands)

Test commands with `@oclif/test`:

```typescript
import { test } from '@oclif/test'

describe('worktree add', () => {
  test
    .stdout()
    .command(['worktree add', '--path', '../test', '--branch', 'test'])
    .it('creates a new worktree', (ctx) => {
      expect(ctx.stdout).to.contain('Worktree created')
    })
})
```

### Running Tests

```bash
pnpm test                # Run all tests
pnpm test:watch          # Watch mode
pnpm test:coverage       # With coverage
```

## Git Workflow

### Branching

- `main` - Production-ready code
- `develop` - Integration branch
- `feature/name` - Feature branches
- `fix/name` - Bug fixes

### Commits

Follow conventional commits:

```
feat(worktree): add navigation command
fix(branch): handle deleted branches correctly
docs(readme): update installation instructions
test(worktree): add integration tests
```

### Before Committing

```bash
pnpm format     # Format code
pnpm lint       # Check for issues
pnpm build      # Ensure it compiles
pnpm test       # Run tests
```

## Common Patterns

### Flag Validation

```typescript
async run(): Promise<void> {
  const { flags } = await this.parse(CommandName)

  // Validate required combinations
  if (!flags.branch && !flags.path) {
    this.error('Must specify either --branch or --path')
  }

  // Rest of implementation
}
```

### JSON Output

```typescript
if (flags.json) {
  this.log(
    JSON.stringify({
      status: 'success',
      data: result,
    })
  )
} else {
  // Human-readable output with chalk
  this.log(chalk.green(`✓ Operation completed`))
  this.log(`  Path: ${result.path}`)
}
```

### Error Handling

```typescript
try {
  const result = await gitHelper.operation(params)
  // Handle success
} catch (error) {
  if (error instanceof GitError) {
    this.error(`Git operation failed: ${error.message}`)
  } else {
    this.error(`Unexpected error: ${error}`)
  }
}
```

### Worktree Setup: Rsync/Symlink Coordination

When setting up new worktrees with both rsync and symlink operations, **always match symlink patterns and exclude from rsync first**:

```typescript
// CRITICAL: Match symlink patterns BEFORE rsync execution
// This prevents rsync from copying files that will be symlinked

if (!options.skipSymlink && symlinkConfig.patterns.length > 0) {
  // Match symlink patterns against source directory
  const filesToSymlink = await this.symlinkHelper.matchPatterns(
    sourceTreePath,
    symlinkConfig.patterns
  )

  // Add matched files to rsync exclude patterns
  excludePatterns.push(...filesToSymlink)
}

// Now execute rsync - it will skip symlink-intended files
rsyncResult = await this.rsyncHelper.rsync(sourceTreePath, worktreePath, rsyncConfig, {
  excludePatterns,
})
```

**Why This Matters**:

- **Efficiency**: Prevents wasted rsync operations copying files that will be symlinked
- **No Conflicts**: Eliminates conflicts between rsync and symlink operations
- **Works Regardless of Timing**: Functions correctly whether symlinks are created before or after rsync
- **Clear Separation**: Rsync handles copies, symlinks handle links

**Location**: `src/utils/worktreeSetup.ts` (Phase 4: Rsync)

**Best Practices for Symlink Patterns**:

- **Good**: Non-tracked files that should sync across worktrees
  - `node_modules/` (after install in main worktree)
  - `.env` files (local configuration)
  - `package.json`, lockfiles (if wanting synchronization)
- **Bad**: Git-tracked files that vary between branches
  - These are automatically checked out by git when creating worktrees
  - Symlinking them defeats the purpose of separate worktrees

### Config-First Initialization Pattern

When commands use configuration defaults, load config **before** validation:

```typescript
// Pattern: Load config BEFORE validation when config provides defaults

async run() {
  // 1. Initialize git helper to get repository root
  const gitHelper = createGitHelper()
  const gitRoot = await gitHelper.getRepositoryRoot()

  // 2. Load config BEFORE validating path
  const config = await this.loadAndMergeConfig(...)

  // 3. Validate with config awareness
  const { resolvedPath } = await this.validateAndInitialize(flags, config, gitRoot)
}
```

**Why**: Configuration may provide defaults (like `worktree.defaultPath`) that affect validation logic. Loading config first allows validation to account for these defaults.

**Location**: Commands that use config defaults (e.g., `src/commands/worktree/add.ts`)

## Debugging

### Development Mode

```bash
# Run with Node debugger
node --inspect bin/dev.js worktree list

# VS Code launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Command",
  "program": "${workspaceFolder}/bin/dev.js",
  "args": ["worktree list"],
  "skipFiles": ["<node_internals>/**"]
}
```

### Logging

```typescript
// Use oclif's built-in logging
this.log('Info message')
this.warn('Warning message')
this.error('Error message') // Exits process

// Debug mode (NODE_DEBUG=pando)
if (process.env.NODE_DEBUG?.includes('pando')) {
  this.log('Debug info')
}
```

## Dependencies

### Core Dependencies

- `@oclif/core` - CLI framework
- `simple-git` - Git operations
- `chalk` - Terminal colors
- `inquirer` - Interactive prompts
- `ora` - Spinners

### Dev Dependencies

- `typescript` - Type checking
- `vitest` - Testing
- `@oclif/test` - CLI testing
- `eslint` - Linting
- `prettier` - Formatting

## Task Management with Beads

### Overview

This project uses **Beads** (`bd`) for task management instead of traditional TODO tools. Beads is an AI-first, dependency-aware issue tracker designed specifically for AI coding agents with CLI-first interface and JSON output.

### Why Beads?

- **Agent Memory**: Treats issues as agent memory rather than planning artifacts
- **Dependency Tracking**: Four dependency types (blocks, related, parent-child, discovered-from)
- **Distributed State**: SQLite for local queries, JSONL files in git for distributed sharing
- **JSON-First**: Every command has `--json` flag for programmatic use
- **Git Integration**: Automatic sync with git hooks and `bd sync` command

### Core Workflow

#### 1. Finding Ready Work

```bash
# Get top 5 ready tasks (no blockers)
bd ready --limit 5 --json

# Filter by priority
bd ready --priority 0 --json
```

**MCP Integration**:

```python
mcp__plugin_beads_beads__ready(limit=5, priority=0)
```

#### 2. Claiming Tasks

```bash
# Claim task by setting status to in_progress
bd update pando-3 --status in_progress --json
```

**MCP Integration**:

```python
mcp__plugin_beads_beads__update(
    issue_id="pando-3",
    status="in_progress"
)
```

#### 3. Creating Issues

```bash
# Create with explicit parameters
bd create "Fix authentication bug" \
  -d "Users getting 401 errors on login" \
  -p 0 \
  -t bug \
  --json

# Create with dependencies
bd create "Add rate limiting" \
  -t feature -p 1 \
  --deps discovered-from:pando-1,blocks:pando-5 \
  --json
```

**MCP Integration**:

```python
mcp__plugin_beads_beads__create(
    title="Fix authentication bug",
    description="Users getting 401 errors on login",
    priority=0,
    issue_type="bug"
)
```

#### 4. Tracking Progress with Comments

```bash
# Add progress comment
bd comments add pando-3 "Implemented core logic, testing edge cases" --json

# View all comments
bd comments pando-3 --json
```

#### 5. Completing Tasks

```bash
# Close when done
bd close pando-3 --reason "Implemented and tested" --json
```

**MCP Integration**:

```python
mcp__plugin_beads_beads__close(
    issue_id="pando-3",
    reason="Implemented and tested"
)
```

### Dependency Management

#### Dependency Types

1. **blocks**: Hard blocker (task cannot proceed until blocker is closed)
2. **related**: Soft link (informational only)
3. **parent-child**: Epic/subtask relationship (blocking propagates through hierarchy)
4. **discovered-from**: Links discovered work back to parent task

#### Adding Dependencies

```bash
# Add blocking dependency (pando-5 blocked by pando-3)
bd dep add pando-5 pando-3 --type blocks --json

# Link discovered work back to parent
bd create "Add tests for auth module" -t task -p 1 --json
bd dep add pando-10 pando-3 --type discovered-from --json
```

**MCP Integration**:

```python
mcp__plugin_beads_beads__dep(
    issue_id="pando-5",
    depends_on_id="pando-3",
    dep_type="blocks"
)
```

### Git Integration

#### Automatic Sync

```bash
# Full sync workflow: export + commit + pull + import + push
bd sync --json

# Dry run to preview
bd sync --dry-run
```

**Always run `bd sync` at the end of a coding session** to ensure all issues are committed and pushed.

### AI Agent Best Practices

#### 1. Start Each Session

```bash
# Check workspace context
bd info --json

# Find ready work
bd ready --limit 10 --json
```

#### 2. During Work

```bash
# Claim task before starting
bd update pando-3 --status in_progress --json

# Add progress comments
bd comments add pando-3 "Working on implementation" --json

# Create discovered issues with links
bd create "Add missing tests" -t task -p 1 --json
bd dep add pando-11 pando-3 --type discovered-from --json
```

#### 3. End Each Session

```bash
# Close completed tasks
bd close pando-3 --reason "Completed" --json

# Sync with git
bd sync --json
```

### MCP Server Usage

**Workspace Context**: Always set context before operations:

```python
mcp__plugin_beads_beads__set_context(
    workspace_root="/path/to/project"
)
```

**Common Operations**:

- `mcp__plugin_beads_beads__ready()` - Find ready work
- `mcp__plugin_beads_beads__list()` - List issues with filters
- `mcp__plugin_beads_beads__show()` - Get issue details
- `mcp__plugin_beads_beads__create()` - Create new issue
- `mcp__plugin_beads_beads__update()` - Update issue
- `mcp__plugin_beads_beads__close()` - Close issue
- `mcp__plugin_beads_beads__stats()` - Get project statistics
- `mcp__plugin_beads_beads__blocked()` - Show blocked issues

### Issue Lifecycle

```
open → in_progress → closed
  ↓         ↓
blocked ←───┘
```

**Status Values**:

- `open`: Ready to work on (if no blockers)
- `in_progress`: Currently being worked on
- `blocked`: Has unresolved dependencies
- `closed`: Completed

### Querying Issues

```bash
# List all open issues
bd list --status open --json

# Filter by multiple criteria
bd list --priority 1 --type feature --json

# Show full issue details with dependencies
bd show pando-3 --json

# Find blocked issues
bd blocked --json

# Get project statistics
bd stats --json
```

### Labels and Organization

```bash
# Add labels
bd label add pando-3 backend urgent --json

# Filter by labels
bd list --label backend,urgent --json

# List all labels
bd label list-all --json
```

## Project Status

### Current Phase

**Scaffolding Complete** - All stubs in place, ready for implementation

### Ready for Implementation

- All command files have TODOs with step-by-step guidance
- Test files are scaffolded
- GitHelper has method signatures defined
- Documentation is complete

### Next Steps (Managed in Beads)

Use `bd ready --json` to see current ready tasks. Track implementation progress through beads issues.

## Resources

- [oclif Documentation](https://oclif.io/docs/introduction)
- [simple-git Documentation](https://github.com/steveukx/git-js)
- [Git Worktree Docs](https://git-scm.com/docs/git-worktree)
- [Project README](./README.md)
- [Architecture Doc](./ARCHITECTURE.md)
- [Design Doc](./DESIGN.md)

## When in Doubt

1. **Follow existing patterns** - Look at similar code
2. **Check the docs** - ARCHITECTURE.md and DESIGN.md explain rationale
3. **Keep it simple** - Don't over-engineer
4. **Write tests** - Test as you implement
5. **Ask questions** - Add comments or TODOs if uncertain

## AI Assistant Notes

### This codebase is optimized for AI collaboration:

- **Clear structure**: Predictable file organization
- **Focused files**: Single responsibility, easy to understand
- **Type safety**: TypeScript provides guardrails
- **TODO comments**: Step-by-step implementation guides
- **Tests first**: Test structure guides implementation
- **Beads integration**: AI-first task management with dependency tracking

### When implementing:

1. **Start session**: Check `bd ready --json` for available work
2. **Claim task**: Update task status to `in_progress` before starting
3. Read related docs (ARCHITECTURE.md, DESIGN.md)
4. Follow existing patterns in similar files
5. Implement incrementally (one function at a time)
6. Write tests alongside implementation
7. **Track discoveries**: Create new issues for discovered work and link with `discovered-from`
8. **Add comments**: Use `bd comments add` to track progress
9. Keep changes focused and atomic
10. **Complete task**: Close issue when done
11. **End session**: Run `bd sync` to commit all changes

### Code Review Checklist:

- [ ] TypeScript strict mode passes
- [ ] Tests pass
- [ ] Follows naming conventions
- [ ] Has JSDoc comments
- [ ] Handles errors appropriately
- [ ] Supports --json flag (for commands)
- [ ] **Documentation updated** (README.md, ARCHITECTURE.md, DESIGN.md, CLAUDE.md as needed)
- [ ] **DESIGN.md exists** in feature directories with 2+ files
- [ ] **ARCHITECTURE.md updated** if architectural changes were made
- [ ] Documentation is synchronized with code changes
- [ ] **Beads issue updated** with progress and completion status
- [ ] **New issues created** for discovered work with proper dependencies
- [ ] **Beads synced** with `bd sync` at end of session
