# Worktree Commands Design

## Purpose

This module provides CLI commands for managing git worktrees. Git worktrees allow developers to check out multiple branches simultaneously in different directories, enabling parallel development without branch switching overhead.

## Files Overview

- **add.ts** - Creates new worktrees linked to the repository
  - Handles path, branch, and commit specification
  - Validates inputs and delegates to GitHelper

- **list.ts** - Displays all worktrees with their metadata
  - Supports verbose mode for detailed information
  - Provides JSON output for scripting

- **remove.ts** - Safely removes worktrees
  - Includes safety checks for uncommitted changes
  - Force flag for overriding safety checks

- **navigate.ts** - Helps users navigate to worktrees
  - Supports lookup by branch name or path
  - Outputs paths for shell evaluation (`cd $(pando worktree:navigate ...)`)

## Key Design Decisions

### Flag-Driven Interface
**Chosen**: All parameters passed via named flags (`--path`, `--branch`)
**Rationale**:
- More explicit and self-documenting
- Order-independent
- Easier to extend with optional parameters
- Better for automation and scripting

**Alternative Rejected**: Positional arguments
- Would require fixed order
- Less clear what each argument represents
- Harder to add optional parameters

### JSON Output Support
**Chosen**: Every command supports `--json` flag for machine-readable output
**Rationale**:
- Enables scripting and automation
- Supports AI agent integration
- Consistent with automation-first design philosophy

**Structure**:
```json
{
  "status": "success",
  "data": { /* command-specific data */ }
}
```

### Interactive Prompts as Fallback
**Chosen**: Prompt for missing required flags instead of erroring
**Rationale**:
- Better user experience for interactive use
- Teaches users what flags are available
- Doesn't sacrifice scriptability (flags still work)

**Trade-off**: Slightly more complex command logic, but much better UX

### Navigation Pattern
**Chosen**: Output paths/commands for shell evaluation
**Rationale**:
- CLI can't change parent shell's directory
- Standard Unix pattern for navigation helpers
- Works across all shells (bash, zsh, fish)

**Usage**:
```bash
cd $(pando worktree:navigate --branch feature-x --output-path)
```

## Patterns Used

### Command Pattern
Each command is a self-contained class following oclif conventions:
- Static `description` for help text
- Static `examples` for documentation
- Static `flags` for argument parsing
- `async run()` for execution

### Delegation Pattern
Commands delegate business logic to GitHelper:
```typescript
// Command: CLI concerns only
const result = await gitHelper.addWorktree(flags.path, flags)

// GitHelper: Git operations and business logic
```

### Output Formatting Strategy
Conditional formatting based on `--json` flag:
```typescript
if (flags.json) {
  this.log(JSON.stringify({ status: 'success', data: result }))
} else {
  this.log(chalk.green(`✓ Worktree created at ${result.path}`))
}
```

## Dependencies

### External
- `@oclif/core` - Command framework, flag parsing
- `chalk` - Terminal colors (planned for non-JSON output)
- `inquirer` - Interactive prompts (planned for missing flags)
- `ora` - Spinners for long operations (planned)

### Internal
- `GitHelper` from `src/utils/git.ts` - All git operations
- `WorktreeInfo`, `BranchInfo` types

## Usage Examples

### Adding a Worktree
```typescript
// Interactive
pando worktree:add
// Prompts: Path? Branch?

// Scripted
pando worktree:add --path ../feature-x --branch feature-x

// From specific commit
pando worktree:add --path ../hotfix --branch hotfix --commit abc123

// JSON output
pando worktree:add --path ../feature-x --branch feature-x --json
```

### Listing Worktrees
```typescript
// Simple list
pando worktree:list

// Verbose
pando worktree:list --verbose

// For scripts
pando worktree:list --json | jq '.data[] | select(.branch == "main")'
```

### Removing Worktrees
```typescript
// Safe removal
pando worktree:remove --path ../feature-x

// Force removal
pando worktree:remove --path ../feature-x --force
```

### Navigating to Worktrees
```typescript
# By branch name
cd $(pando worktree:navigate --branch feature-x --output-path)

# By path
cd $(pando worktree:navigate --path ../feature-x --output-path)

# With shell alias
alias goto='cd $(pando worktree:navigate --output-path --branch $1)'
goto feature-x
```

## Testing Approach

### Integration Tests
Use `@oclif/test` to test command behavior:
```typescript
test
  .stdout()
  .command(['worktree:add', '--path', '../test', '--branch', 'test'])
  .it('creates a new worktree', ctx => {
    expect(ctx.stdout).to.contain('Worktree created')
  })
```

### Mock Strategy
Mock GitHelper methods to test command logic without git operations:
```typescript
vi.mock('../../utils/git', () => ({
  createGitHelper: () => ({
    addWorktree: vi.fn().mockResolvedValue({ path: '../test', branch: 'test' })
  })
}))
```

## Error Handling

### Input Validation
- Check for required flag combinations
- Validate paths are not already worktrees
- Ensure branches/commits exist

### Git Operation Errors
- Catch errors from GitHelper
- Transform to user-friendly messages
- Use `this.error()` for oclif error handling

### Example
```typescript
try {
  await gitHelper.addWorktree(flags.path, { branch: flags.branch })
} catch (error) {
  if (error.message.includes('already exists')) {
    this.error(`Worktree already exists at ${flags.path}`)
  } else {
    this.error(`Failed to create worktree: ${error.message}`)
  }
}
```

## Future Considerations

### Planned Enhancements
1. **Fuzzy Branch Matching** - `navigate --branch feat` finds `feature-x`
2. **Worktree Templates** - Pre-configured setups for new worktrees
3. **Interactive Selection** - Use inquirer to select from list
4. **Worktree Status** - Show uncommitted changes, behind/ahead status
5. **Bulk Operations** - Add/remove multiple worktrees at once

### Possible Commands
- `worktree:sync` - Sync with remote
- `worktree:status` - Show status of all worktrees
- `worktree:clean` - Remove prunable worktrees
- `worktree:switch` - Output cd command to switch between worktrees

### Editor Integration
Potential commands for IDE integration:
- `worktree:open --editor code` - Open worktree in VSCode
- `worktree:workspace` - Generate multi-root workspace file

## Related Documentation

- [Root ARCHITECTURE.md](../../../ARCHITECTURE.md) - Overall system architecture
- [Root DESIGN.md](../../../DESIGN.md) - High-level design decisions
- [README.md](../../../README.md) - User-facing documentation
