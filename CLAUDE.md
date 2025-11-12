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

  static examples = [
    '<%= config.bin %> <%= command.id %> --required-flag value',
  ]

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

describe('worktree:add', () => {
  test
    .stdout()
    .command(['worktree:add', '--path', '../test', '--branch', 'test'])
    .it('creates a new worktree', ctx => {
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
  this.log(JSON.stringify({
    status: 'success',
    data: result
  }))
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

## Debugging

### Development Mode

```bash
# Run with Node debugger
node --inspect bin/dev.js worktree:list

# VS Code launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Command",
  "program": "${workspaceFolder}/bin/dev.js",
  "args": ["worktree:list"],
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

## Project Status

### Current Phase
**Scaffolding Complete** - All stubs in place, ready for implementation

### Ready for Implementation
- All command files have TODOs with step-by-step guidance
- Test files are scaffolded
- GitHelper has method signatures defined
- Documentation is complete

### Next Steps
1. Implement `GitHelper.isRepository()`
2. Implement `GitHelper.addWorktree()`
3. Implement `worktree:add` command
4. Write tests for above
5. Repeat for other commands

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

### When implementing:
1. Read related docs (ARCHITECTURE.md, DESIGN.md)
2. Follow existing patterns in similar files
3. Implement incrementally (one function at a time)
4. Write tests alongside implementation
5. Keep changes focused and atomic

### Code Review Checklist:
- [ ] TypeScript strict mode passes
- [ ] Tests pass
- [ ] Follows naming conventions
- [ ] Has JSDoc comments
- [ ] Handles errors appropriately
- [ ] Supports --json flag (for commands)
- [ ] Updated README if new command
