# Branch Commands Design

## Purpose

This module provides CLI commands for managing git branches with integrated worktree support. While git provides basic branch operations, pando enhances them by understanding the relationship between branches and worktrees, enabling coordinated management of both.

## Files Overview

- **create.ts** - Creates new branches with optional worktree creation
  - Creates branch from specified base (default: main)
  - Optionally creates worktree for the branch in one step
  - Validates branch doesn't already exist

- **delete.ts** - Safely deletes branches with worktree cleanup
  - Checks if branch is merged before deletion
  - Optionally removes associated worktree
  - Force flag for unmerged branches

## Key Design Decisions

### Integrated Worktree Operations
**Chosen**: Branch commands understand and coordinate with worktrees
**Rationale**:
- Common workflow: Create branch → Create worktree
- Cleanup workflow: Delete worktree → Delete branch
- Reduces cognitive overhead and command count
- Prevents orphaned branches or worktrees

**Example**:
```bash
# Traditional (2 commands)
git branch feature-x
pando worktree:add --path ../feature-x --branch feature-x

# Integrated (1 command)
pando branch:create --name feature-x --worktree ../feature-x
```

### Safety-First Defaults
**Chosen**: Require explicit `--force` for destructive operations
**Rationale**:
- Prevent accidental data loss
- Follow git's own safety conventions
- Make dangerous operations obvious
- Educate users about risks

**Implementation**:
```bash
# Safe (checks if merged)
pando branch:delete --name feature-x

# Unsafe (requires explicit flag)
pando branch:delete --name feature-x --force
```

### Default Base Branch
**Chosen**: Default to 'main' for new branches
**Rationale**:
- Modern git convention (main vs master)
- Most common use case
- Still allows override with `--from` flag

**Configurable in Future**: Could read from git config or .pandorc

## Patterns Used

### Command Pattern
Each command follows oclif conventions with static configuration and async execution.

### Validation Before Execution
Commands validate all inputs before calling GitHelper:
```typescript
async run() {
  const { flags } = await this.parse(CreateBranch)

  // Validate first
  if (await gitHelper.branchExists(flags.name)) {
    this.error(`Branch ${flags.name} already exists`)
  }

  // Then execute
  await gitHelper.createBranch(flags.name, flags.from)
}
```

### Coordinated Operations
Branch operations coordinate with worktree operations when needed:
```typescript
// Delete branch
await gitHelper.deleteBranch(flags.name, flags.force)

// Also cleanup worktree if requested
if (flags['remove-worktree']) {
  const worktree = await gitHelper.findWorktreeByBranch(flags.name)
  if (worktree) {
    await gitHelper.removeWorktree(worktree.path, flags.force)
  }
}
```

## Dependencies

### External
- `@oclif/core` - Command framework
- `chalk` - Terminal colors (planned)
- `inquirer` - Interactive prompts (planned)

### Internal
- `GitHelper` from `src/utils/git.ts` - Git operations
- `BranchInfo`, `WorktreeInfo` types
- Worktree commands (for coordinated operations)

## Usage Examples

### Creating Branches

```bash
# Simple branch creation
pando branch:create --name feature-x

# From specific base
pando branch:create --name feature-x --from develop

# With worktree in one step
pando branch:create --name feature-x --worktree ../feature-x

# JSON output for scripts
pando branch:create --name feature-x --json
```

### Deleting Branches

```bash
# Safe deletion (checks if merged)
pando branch:delete --name feature-x

# Force delete unmerged branch
pando branch:delete --name feature-x --force

# Delete branch and its worktree
pando branch:delete --name feature-x --remove-worktree

# Force delete both
pando branch:delete --name feature-x --force --remove-worktree
```

### Scripting Example

```bash
# Create feature branch with worktree
pando branch:create --name "feature-$TICKET" --worktree "../feature-$TICKET" --json

# Cleanup after merge
pando branch:delete --name "feature-$TICKET" --remove-worktree --json
```

## Testing Approach

### Unit Tests
Test command logic with mocked GitHelper:
```typescript
describe('branch:create', () => {
  it('should create branch', async () => {
    const gitHelper = createMockGitHelper()
    gitHelper.createBranch.mockResolvedValue({ name: 'test', ... })

    await run(['branch:create', '--name', 'test'])

    expect(gitHelper.createBranch).toHaveBeenCalledWith('test', 'main')
  })
})
```

### Integration Tests
Test with real git operations in temp repositories:
```typescript
test
  .stdout()
  .command(['branch:create', '--name', 'test-branch'])
  .it('creates a new branch', ctx => {
    expect(ctx.stdout).to.contain('Created branch: test-branch')
  })
```

### Error Cases to Test
- Branch already exists
- Invalid base branch
- Currently checked out branch deletion
- Unmerged branch deletion without --force
- Missing worktree for --remove-worktree

## Error Handling

### Validation Errors
```typescript
// Branch exists
if (await gitHelper.branchExists(flags.name)) {
  this.error(`Branch '${flags.name}' already exists`)
}

// Invalid base
if (!(await gitHelper.branchExists(flags.from))) {
  this.error(`Base branch '${flags.from}' does not exist`)
}
```

### Git Operation Errors
```typescript
try {
  await gitHelper.deleteBranch(flags.name, flags.force)
} catch (error) {
  if (error.message.includes('not fully merged')) {
    this.error(
      `Branch '${flags.name}' is not fully merged. Use --force to delete anyway.`
    )
  } else {
    this.error(`Failed to delete branch: ${error.message}`)
  }
}
```

### Coordinated Operation Errors
Handle partial failures gracefully:
```typescript
try {
  await gitHelper.deleteBranch(flags.name, flags.force)

  if (flags['remove-worktree']) {
    try {
      await gitHelper.removeWorktree(worktreePath, flags.force)
    } catch (worktreeError) {
      this.warn(`Branch deleted but worktree removal failed: ${worktreeError.message}`)
    }
  }
} catch (branchError) {
  this.error(`Failed to delete branch: ${branchError.message}`)
}
```

## Future Considerations

### Planned Features
1. **Branch Templates** - Create branches with predefined structure
   ```bash
   pando branch:create --name feature-x --template feature
   # Creates branch, worktree, runs setup scripts
   ```

2. **Branch Status** - Show merge status, tracking info
   ```bash
   pando branch:list --status
   # Shows: merged, unmerged, tracking remote, behind/ahead
   ```

3. **Interactive Selection** - Select branch from list
   ```bash
   pando branch:delete
   # Shows list of branches to choose from
   ```

4. **Bulk Operations** - Create/delete multiple branches
   ```bash
   pando branch:delete --pattern "feature/*" --merged
   # Deletes all merged feature branches
   ```

### Configuration Support
Future `.pandorc` support:
```json
{
  "branch": {
    "defaultBase": "develop",
    "autoWorktree": true,
    "worktreeDir": "../worktrees"
  }
}
```

### Additional Commands
- `branch:rename` - Rename branch and update worktree
- `branch:list` - List branches with worktree info
- `branch:checkout` - Create worktree if doesn't exist
- `branch:merge` - Merge and cleanup worktree

### Remote Operations
- `branch:push` - Push with tracking setup
- `branch:pull` - Pull and update worktrees
- `branch:sync` - Sync remote tracking branches

## Branch-Worktree Relationship

### Mapping
- One branch can have **at most one** worktree
- One worktree always has **exactly one** branch checked out
- Main worktree (repository root) is special case

### Lifecycle Coordination
```
Create:
  branch:create --name X
  └─> Branch X exists

  branch:create --name X --worktree PATH
  ├─> Branch X exists
  └─> Worktree at PATH with branch X

Delete:
  branch:delete --name X
  └─> Branch X deleted (worktree remains)

  branch:delete --name X --remove-worktree
  ├─> Branch X deleted
  └─> Worktree removed if found
```

## Related Documentation

- [Worktree Commands DESIGN.md](../worktree/DESIGN.md) - Related worktree operations
- [Root ARCHITECTURE.md](../../../ARCHITECTURE.md) - System architecture
- [Root DESIGN.md](../../../DESIGN.md) - High-level design decisions
- [README.md](../../../README.md) - User documentation
