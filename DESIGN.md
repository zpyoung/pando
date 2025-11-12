# Pando Design Document

This document explains the design decisions, trade-offs, and rationale behind Pando's implementation.

## Design Principles

### 1. **Automation-First Design**

**Decision**: Every command must support both interactive and non-interactive modes

**Rationale**:
- Modern development increasingly involves AI agents and automation
- Scripts and CI/CD pipelines need reliable, parseable output
- Humans and machines have different interface needs

**Implementation**:
- All flags are optional with interactive prompts as fallback
- `--json` flag on every command for machine-readable output
- Consistent exit codes for scripting

**Example**:
```bash
# Interactive (human)
pando worktree:add
# Prompts: Path? Branch?

# Scripted (machine)
pando worktree:add --path ../feature-x --branch feature-x --json
# {"path": "../feature-x", "branch": "feature-x", "commit": "abc123"}
```

### 2. **Predictable Command Structure**

**Decision**: Use oclif's topic:command pattern

**Rationale**:
- Scales well (can add topics without conflicts)
- Self-documenting (`worktree:add` is clearer than `add-worktree`)
- Follows industry conventions (Heroku CLI, Salesforce CLI)
- Built-in help generation

**Trade-off**:
- Slightly more typing than flat commands
- But: Better organization for 10+ commands

### 3. **Focused, Single-Responsibility Files**

**Decision**: One command per file, one utility class

**Rationale**:
- AI tools work better with focused files
- Easier code navigation and maintenance
- Clear boundaries reduce coupling
- Supports vertical slice architecture

**Implementation**:
```
src/commands/worktree/add.ts     # Only handles worktree:add
src/commands/worktree/remove.ts  # Only handles worktree:remove
```

Each file is ~100-200 lines, highly focused.

### 4. **Type Safety Throughout**

**Decision**: Strict TypeScript with no `any` types

**Rationale**:
- Catch bugs at compile time
- Better IDE support (autocomplete, refactoring)
- Self-documenting code
- Easier refactoring with confidence

**Configuration**:
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "noUncheckedIndexedAccess": true
}
```

## Key Design Decisions

### Why oclif?

**Alternatives Considered**:
1. **Commander.js**: Popular, lightweight
2. **Yargs**: Feature-rich, flexible
3. **Ink (React)**: For TUIs
4. **Custom parser**: Maximum control

**Why oclif Won**:
- Production-ready plugin system
- Built-in testing utilities (@oclif/test)
- Automatic help generation
- Used by major CLIs (Heroku, Salesforce)
- TypeScript-first design
- Excellent documentation

**Trade-off**:
- Heavier than Commander
- But: Worth it for the features we get

### Why simple-git?

**Alternatives Considered**:
1. **child_process.exec**: Direct git commands
2. **nodegit**: libgit2 bindings
3. **isomorphic-git**: Pure JavaScript git

**Why simple-git Won**:
- Promise-based (async/await friendly)
- Maintained and popular
- Good balance of abstraction and control
- Handles edge cases (escaping, errors)
- Small bundle size

**Trade-off**:
- Still shells out to git binary
- But: Simplest and most reliable approach

### Command vs. Utility Separation

**Decision**: Commands handle CLI concerns, utilities handle git logic

**Rationale**:
```
Command Layer:
- Parses flags
- Validates user input
- Formats output
- Handles interactive prompts

Utility Layer:
- Pure business logic
- Git operations
- No CLI concerns
- Independently testable
```

**Benefit**: Can reuse GitHelper in other contexts (programmatic usage)

**Example**:
```typescript
// Command: CLI concerns
async run() {
  const { flags } = await this.parse(AddWorktree)

  // Interactive fallback
  if (!flags.path) {
    flags.path = await prompt('Path?')
  }

  // Delegate to utility
  const result = await gitHelper.addWorktree(flags.path, flags)

  // Format output
  if (flags.json) {
    this.log(JSON.stringify(result))
  } else {
    this.log(chalk.green(`Created worktree at ${result.path}`))
  }
}

// Utility: Pure logic
async addWorktree(path, options) {
  await this.git.raw(['worktree', 'add', path, ...])
  return { path, branch: options.branch, ... }
}
```

### Flag-Driven vs. Argument-Based

**Decision**: Use flags (`--path`) instead of positional arguments

**Rationale**:
- More explicit and self-documenting
- Order-independent
- Easier to add optional parameters
- Better for automation (named parameters)

**Example**:
```bash
# Flag-based (chosen)
pando worktree:add --path ../feature-x --branch feature-x

# Argument-based (rejected)
pando worktree:add ../feature-x feature-x
# What if branch is optional? Order matters!
```

**Trade-off**:
- More typing for humans
- But: Clearer and more maintainable

### JSON Output Format

**Decision**: Consistent structure across all commands

**Format**:
```typescript
// Success (single result)
{ "status": "success", "data": { ... } }

// Success (list)
{ "status": "success", "data": [ ... ] }

// Error
{ "status": "error", "message": "...", "code": "ERR_CODE" }
```

**Rationale**:
- Easy to parse programmatically
- Consistent across commands
- Supports error handling in scripts

### Safety-First Defaults

**Decision**: Require explicit flags for destructive operations

**Examples**:
```bash
# Safe by default
pando worktree:remove --path ../feature-x
# → Warns about uncommitted changes

# Explicit force
pando worktree:remove --path ../feature-x --force
# → Removes even with changes

# Branch deletion
pando branch:delete --name feature-x
# → Checks if merged

pando branch:delete --name feature-x --force
# → Forces deletion
```

**Rationale**:
- Prevent accidental data loss
- Make dangerous operations obvious
- Follow git's own conventions

### Worktree Navigation Pattern

**Decision**: Output paths for shell evaluation

**Problem**: CLI can't change parent shell's directory

**Solution**: Output commands/paths for evaluation

```bash
# Output path for cd
cd $(pando worktree:navigate --branch feature-x --output-path)

# Or create shell alias
alias goto-worktree='cd $(pando worktree:navigate --output-path --branch $1)'
goto-worktree feature-x
```

**Rationale**:
- Works across shells (bash, zsh, fish)
- Composable with other commands
- Standard Unix pattern

**Alternative Considered**: Shell integration scripts
- **Rejected**: Too complex, shell-specific

## AI-Friendly Design Patterns

### Consistent File Organization

```
src/commands/topic/verb.ts    # Always verb-based names
test/commands/topic/verb.test.ts  # Mirrors src structure
```

**Benefit**: Predictable paths for AI code navigation

### Verbose, Descriptive Names

```typescript
// Good (explicit)
async addWorktree(path: string, options: AddWorktreeOptions)

// Avoid (ambiguous)
async add(p: string, opts: any)
```

**Benefit**: AI can infer purpose without context

### TODO Comments for Stubs

```typescript
async run() {
  // TODO: Implement worktree add logic
  // 1. Validate the repository is a git repo
  // 2. Check if path already exists
  // 3. Validate branch/commit if provided
  // ...
}
```

**Benefit**: Clear implementation roadmap for AI completion

### Type-First Development

```typescript
// Define types first
interface WorktreeInfo { ... }

// Then implement
async listWorktrees(): Promise<WorktreeInfo[]> { ... }
```

**Benefit**: Type system guides implementation

## Future Design Considerations

### Plugin System

**Idea**: Allow community-contributed commands

```bash
pando plugins:install worktree-backup
pando worktree:backup --to s3://...
```

**Challenges**:
- Security (arbitrary code execution)
- Versioning and compatibility
- Discovery and distribution

**oclif Support**: Built-in plugin system available

### Configuration Files

**Idea**: `.pandorc` for defaults and preferences

```json
{
  "defaultBranch": "main",
  "worktreeDir": "../worktrees",
  "editor": "code",
  "format": "json"
}
```

**Challenges**:
- Where to look for config (repo, home, global)
- Schema versioning
- Overriding via flags

### Editor Integration

**Idea**: Helper commands for editor navigation

```bash
# Open worktree in VSCode
pando worktree:open --branch feature-x --editor code

# Generate workspace file
pando worktree:workspace --output pando.code-workspace
```

**Benefit**: Seamless workflow integration

### Template System

**Idea**: Worktree templates with pre-configured setups

```bash
pando worktree:add --template feature --path ../feature-x
# Creates worktree + installs deps + runs setup
```

**Use Case**: Standardize team workflows

## Testing Philosophy

### Test What Matters

1. **Command parsing**: Flags work correctly
2. **Error handling**: Failures are graceful
3. **Output format**: JSON is valid, text is readable
4. **Business logic**: GitHelper methods behave correctly

### Don't Test Internals

- Don't test private methods
- Don't mock too much (makes tests brittle)
- Focus on public API

### Use Real Git When Possible

Integration tests with temporary repos are valuable:

```typescript
it('should create and list worktrees', async () => {
  const repo = await createTempRepo()
  await run(['worktree:add', '--path', `${repo}/feature`, '--branch', 'test'])
  const list = await run(['worktree:list', '--json'])
  expect(JSON.parse(list)).toHaveLength(2)
  await cleanupTempRepo(repo)
})
```

## Performance Philosophy

### Optimize for Common Case

**Common**: Single worktree operations
**Rare**: Bulk operations on 100+ worktrees

**Decision**: Optimize for clarity over bulk performance

### Git is the Bottleneck

JavaScript execution is negligible compared to git operations.

**Focus**: Minimize git calls, not JavaScript optimizations

## Accessibility & Usability

### Help Text is First-Class

Every command has:
- Clear description
- Examples
- Flag documentation

Generated automatically by oclif from code.

### Progressive Disclosure

```bash
# Minimal command
pando worktree:add

# Prompts guide user

# Expert usage
pando worktree:add --path ../f --branch f --commit abc --json
```

Supports both learning and efficiency.

## Evolution Strategy

### Versioning

Follow Semantic Versioning:
- **Major**: Breaking CLI changes
- **Minor**: New commands/flags (backward compatible)
- **Patch**: Bug fixes

### Deprecation Path

When changing commands:
1. Add new command/flag
2. Deprecate old with warning
3. Remove in next major version

Example:
```
v0.x: --worktree flag
v1.0: --worktree deprecated (use --path)
v2.0: --worktree removed
```

## Summary

Pando's design prioritizes:
1. **Automation-first**: Scripts and AI agents are first-class users
2. **Type safety**: Catch errors early with strict TypeScript
3. **Clarity**: Predictable structure, descriptive names, focused files
4. **Safety**: Explicit flags for destructive operations
5. **Extensibility**: Clean architecture enables easy additions

These principles guide all implementation decisions and ensure Pando remains maintainable and useful as it grows.

---

For architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For usage instructions, see [README.md](./README.md).
