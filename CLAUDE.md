# Claude Code Context for Pando

TypeScript CLI for Git worktrees using oclif, simple-git, with automation-first design.

## Quick Reference

```bash
# Project
pnpm install | build | dev <cmd> | test | lint | format | validate

# Beads (Task Management) - prefix: pando-, db: .beads/pando.db
bd ready --json              # Find unblocked work
bd list|show|create|close    # CRUD operations
bd update <id> --status in_progress  # Claim task
bd sync                      # Git sync (run at session end)
```

**Directories**: `src/commands/` (CLI), `src/utils/` (logic), `test/` (mirrors src), `bin/`, `dist/`

## Architecture Patterns

### Command Pattern
```typescript
// src/commands/verb.ts (top-level) or src/commands/topic/verb.ts (nested)
import { Command, Flags } from '@oclif/core'

export default class Add extends Command {
  static description = 'Clear description'
  static examples = ['<%= config.bin %> <%= command.id %> --flag value']
  static flags = {
    flag: Flags.string({ char: 'f', description: 'desc', required: true }),
    json: Flags.boolean({ char: 'j', description: 'JSON output', default: false }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Add)
    // 1. Validate  2. Call GitHelper  3. Format output (--json)
  }
}
```

### Utility Pattern
```typescript
// src/utils/git.ts - business logic on GitHelper class
export class GitHelper {
  async operationName(params: Type): Promise<ReturnType> {
    // Use this.git (simple-git), handle errors, return typed results
  }
}
```

### Test Pattern
```typescript
// Vitest - test business logic directly, not command execution
import { describe, it, expect } from 'vitest'

describe('feature', () => {
  it('should do thing', () => {
    // Test logic directly, avoid complex oclif mocking
  })
})
```

### Error Handling (src/utils/errors.ts)
```typescript
import { ErrorHelper } from '../utils/errors.js'  // ../../ for nested commands

ErrorHelper.validation(this, 'User error message', flags.json)  // Expected errors
ErrorHelper.operation(this, error as Error, 'Context', flags.json)  // Runtime failures
ErrorHelper.unexpected(this, new Error('Bug - shows stack'))  // Internal bugs
ErrorHelper.warn(this, 'Non-fatal warning', flags.json)  // Warnings

// TypeScript flow: add `return` after validation() for type narrowing
```

**JSON output**: `{ status: 'error'|'warning', error|warning: 'msg', context?, details? }`

## Coding Conventions

### TypeScript
- **Strict types**: No `any`, explicit types, interfaces for data
- **Async/Await**: All I/O uses promises
- **Type guards** for error objects: `function isExecError(e): e is ExecError`

### Naming
- Commands: `Verb` (top-level) or `VerbTopic` (nested)
- Files: `kebab-case.ts`
- Variables: `camelCase`, Types: `PascalCase`, Constants: `UPPER_SNAKE_CASE`

### Organization
```
src/commands/verb.ts              # Top-level (add, list, remove)
src/commands/topic/verb.ts        # Nested (config/init)
```
Keep files <250 lines. Extract utilities if longer.

## Common Tasks

### Adding a New Command
1. Create `src/commands/verb.ts` (or `topic/verb.ts`)
2. Create `test/commands/verb.test.ts`
3. Update README.md with examples
4. Verify: `pnpm dev verb --help`

### Adding Git Operations
1. Add method to `GitHelper` in `src/utils/git.ts`
2. Add tests in `test/utils/git.test.ts`
3. Use in command layer

### Adding Config Values
1. **Schema** (`src/config/schema.ts`): Zod schema + interface + `DEFAULT_CONFIG`
2. **Env** (`src/config/env.ts`): `ENV_VAR_MAP` entry
3. **Config init** (`src/commands/config/init.ts`): `generateTomlContent()` + merge block
4. **Example** (`.pando.toml.example`): Document option
5. **README.md**: Flag/env documentation
6. **Tests**: For new option

## Key Patterns

### JSON Output
```typescript
if (flags.json) {
  this.log(JSON.stringify({ status: 'success', data: result }))
} else {
  this.log(chalk.green(`✓ Done`))
}
```

### User-Friendly Errors
```typescript
ErrorHelper.validation(this,
  `Branch '${branch}' exists.\n\nOptions:\n` +
  `  • --force to reset\n  • --branch <new> for different name`, flags.json)
```

### Flag Consistency Warnings
```typescript
if (flags['skip-rsync'] && (flags['rsync-flags'] || flags['rsync-exclude'])) {
  ErrorHelper.warn(this, 'rsync flags ignored when --skip-rsync set', flags.json)
}
```

### Rsync/Symlink Coordination
```typescript
// CRITICAL: Match symlink patterns BEFORE rsync to exclude them
if (!options.skipSymlink && symlinkConfig.patterns.length > 0) {
  const filesToSymlink = await this.symlinkHelper.matchPatterns(sourceTreePath, symlinkConfig.patterns)
  excludePatterns.push(...filesToSymlink)
}
rsyncResult = await this.rsyncHelper.rsync(source, dest, config, { excludePatterns })
```
**Location**: `src/utils/worktreeSetup.ts` (Phase 4)

### Transactional Rollback
```typescript
this.transaction.createCheckpoint('worktree', { path: worktreePath })
try { /* operations */ } catch {
  const result = await this.transaction.rollback()
  // Get checkpoint from result, not transaction (cleared after rollback)
  const checkpoint = result.checkpoints.get('worktree')
}
```
**Location**: `src/utils/worktreeSetup.ts`

### Config-First Initialization
```typescript
// Load config BEFORE validation when config provides defaults
const gitRoot = await gitHelper.getRepositoryRoot()
const config = await this.loadAndMergeConfig(...)
const { resolvedPath } = await this.validateAndInitialize(flags, config, gitRoot)
```

### Parent Directory Creation
```typescript
// git worktree add doesn't create parent dirs
await fs.ensureDir(path.dirname(resolvedPath))
```

### Real-time Progress (spawn vs exec)
```typescript
// Use spawn for real-time streaming, exec for buffered output
const process = spawn('rsync', args)
process.stdout.on('data', (data) => { /* throttled progress updates */ })
```
**Location**: `src/utils/fileOps.ts`

### External Tool Version Detection
```typescript
interface VersionInfo { installed: boolean; version?: string; major?: number; supportsFeatureX: boolean }
// Cache result, handle missing tools gracefully, enable features conditionally
```

## Testing

```bash
pnpm test              # All tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage
```

**Cross-platform paths**: Use `path.join()` in assertions, never hardcode separators.

### Mocking simpleGit for Worktree Operations (Unit Tests Only)
```typescript
// When unit testing methods that create new simpleGit(path) instances
// (e.g., setSkipWorktree, hasUncommittedChanges, rebaseBranchInWorktree)
// E2E tests use real git operations - no mocking needed there
const mockWorktreeGit = { raw: vi.fn(), status: vi.fn(), rebase: vi.fn() }

vi.mock('simple-git', async () => {
  const actual = await vi.importActual('simple-git')
  return {
    ...actual,
    simpleGit: vi.fn((path?: string) => {
      if (path) return mockWorktreeGit  // Worktree-specific operations
      return (actual as { simpleGit: (path?: string) => unknown }).simpleGit(path)
    }),
  }
})
```
**Location**: `test/utils/git.test.ts`

## Git Workflow

**Branches**: `main` (prod), `develop` (integration), `feature/name`, `fix/name`

**Commits**: `feat|fix|docs|test(scope): message`

**Pre-commit**: `pnpm format && pnpm lint && pnpm build && pnpm test`

## Dependencies

**Core**: `@oclif/core`, `simple-git`, `chalk`, `inquirer`, `ora`
**Dev**: `typescript`, `vitest`, `@oclif/test`, `eslint`, `prettier`

## Beads Task Management

AI-first issue tracker with dependency tracking. DB: `.beads/pando.db`, State: `.beads/issues.jsonl` (git)

### Workflow
```bash
# Start session
bd ready --limit 10 --json

# Claim & work
bd update pando-3 --status in_progress --json
bd comments add pando-3 "Progress note" --json

# Discovered work
bd create "New task" -t task -p 1 --json
bd dep add pando-11 pando-3 --type discovered-from --json

# Complete
bd close pando-3 --reason "Done" --json
bd sync  # Always at session end
```

### Dependency Types
- `blocks`: Hard blocker
- `related`: Soft link
- `parent-child`: Epic/subtask
- `discovered-from`: Links to parent task

### MCP
```python
mcp__plugin_beads_beads__set_context(workspace_root="/path")  # First!
mcp__plugin_beads_beads__ready|list|show|create|update|close|stats|blocked()
```

### Lifecycle
`open → in_progress → closed` (can go to `blocked` from any state)

## Documentation Rules

**Auto-update docs with code changes** - don't ask, just do it.

| Change Type | Update |
|-------------|--------|
| User-facing behavior | README.md |
| Architecture changes | ARCHITECTURE.md |
| Module add/modify | DESIGN.md in folder |
| Project patterns | CLAUDE.md |

**Create ARCHITECTURE.md**: Major dirs, 5+ files, new patterns
**Create DESIGN.md**: Feature dirs with 2+ files, utility modules

### SDD Files (`ai-docs/`)
- `SPEC.md`: Goals/stories (start here)
- `PLAN.md`: Architecture
- `TASKS.md`: Checklist
- `CONTEXT.md`: Glossary
- `LESSONS.md`: Patterns to keep/avoid

## AI Implementation Checklist

### Session Start
1. `bd ready --json` - find work
2. `bd update <id> --status in_progress` - claim

### During Work
- Read ARCHITECTURE.md, DESIGN.md
- Follow existing patterns
- Implement incrementally, test alongside
- Track discoveries: create issues with `discovered-from`

### Session End
1. `bd close <id> --reason "msg"` - complete tasks
2. `bd sync` - commit to git

### Code Review
- [ ] TypeScript strict passes
- [ ] Tests pass
- [ ] Naming conventions followed
- [ ] Errors handled with ErrorHelper
- [ ] `--json` flag supported
- [ ] Docs updated (README, DESIGN, ARCHITECTURE, CLAUDE as needed)
- [ ] Beads synced

## Resources

- [oclif](https://oclif.io/docs/introduction) | [simple-git](https://github.com/steveukx/git-js) | [git-worktree](https://git-scm.com/docs/git-worktree)
- [README](./README.md) | [ARCHITECTURE](./ARCHITECTURE.md) | [DESIGN](./DESIGN.md)
