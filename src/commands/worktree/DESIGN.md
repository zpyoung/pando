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

- **remove.ts** - Safely removes worktrees with interactive selection
  - Interactive multi-select when --path not provided
  - Confirmation step before removal
  - Batch removal with error resilience
  - Safety checks for uncommitted changes
  - Force flag for overriding safety checks

- **navigate.ts** - Helps users navigate to worktrees
  - Supports lookup by branch name or path
  - Outputs paths for shell evaluation (`cd $(pando worktree navigate ...)`)

## Key Design Decisions

### Branch Handling: Create vs. Checkout
**Chosen**: Automatically detect whether to create or checkout branches based on existence
**Rationale**:- Simplifies user experience - same command works for both cases
- Reduces cognitive load - users don't need to remember different flags
- Matches git worktree's natural behavior
- Enables force-reset workflows with `--force`

**Implementation**:
- **New branch**: Uses `git worktree add -b <branch>` (create new)
- **Existing branch**: Uses `git worktree add <path> <branch>` (checkout existing)
- **Force reset**: Uses `git worktree add -B <branch>` (force create/reset)

**Logic Flow**:
```typescript
if (options.branch) {
  const branchExists = await gitHelper.branchExists(options.branch)

  if (options.force) {
    // Always use -B to force create/reset
    args.push('-B', options.branch)
  } else if (!branchExists) {
    // Use -b to create new branch
    args.push('-b', options.branch)
  }
  // If branch exists and no force: checkout existing (no flag)
}
```

**Examples**:
```bash
# Create new branch
pando worktree add --branch new-feature ../feature
# → git worktree add -b new-feature ../feature

# Checkout existing branch
pando worktree add --branch existing-feature ../feature
# → git worktree add ../feature existing-feature

# Force reset branch to current HEAD/commit
pando worktree add --branch feature --force ../feature
# → git worktree add -B feature ../feature
```

**Validation**:- `--force` requires `--branch` to be specified
- When using `--branch` and `--commit` together without `--force`, validates branch doesn't already exist

### Flag-Driven Interface with Config Defaults
**Chosen**: All parameters passed via named flags (`--path`, `--branch`) with optional config defaults
**Rationale**:
- More explicit and self-documenting
- Order-independent
- Easier to extend with optional parameters
- Better for automation and scripting
- Config defaults reduce repetitive flag usage

**Path Resolution Priority**:
1. CLI flag (`--path`) - Highest priority
2. Config default (`worktree.defaultPath` in `.pando.toml`) - Used if no flag provided
3. Error - Required if neither flag nor config provided

**Path Resolution Logic**:
- When using config default with `--branch` flag, branch name is appended to default path
- Relative paths resolve from git repository root
- Absolute paths are used as-is
- **Branch name sanitization**: Forward slashes (`/`) are converted to underscores (`_`) for filesystem safety

**Example**:
```toml
# .pando.toml
[worktree]
defaultPath = "../worktrees"
```

```bash
# Creates ../worktrees/feature-x (relative to git root)
pando worktree add --branch feature-x

# Branch names with slashes are sanitized: feature/auth becomes feature_auth
pando worktree add --branch feature/auth
# Creates: ../worktrees/feature_auth

# Explicit path overrides config
pando worktree add --path /custom/path --branch feature-x
```

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

**Implementation**: `worktree remove` uses this pattern:
- When `--path` omitted: Interactive multi-select from available worktrees
- Excludes main worktree from selection
- Shows prunable worktrees with indicator (🗑️)
- Requires confirmation before removal
- Supports batch removal with error resilience (continues on individual failures)
- JSON mode still requires `--path` to maintain scriptability

### Navigation Pattern
**Chosen**: Output paths/commands for shell evaluation
**Rationale**:
- CLI can't change parent shell's directory
- Standard Unix pattern for navigation helpers
- Works across all shells (bash, zsh, fish)

**Usage**:
```bash
cd $(pando worktree navigate --branch feature-x --output-path)
```

## Post-Creation Setup (New Feature)

### Rsync Operation
After creating a worktree, pando can automatically copy files from the main worktree:

**Purpose**: Copy gitignored files that aren't tracked by git
- `node_modules/` for Node.js projects
- `.env` files with environment variables
- Build artifacts from previous builds
- Any other gitignored files

**Configuration**: Via `.pando.toml` or other config files
```toml
[rsync]
enabled = true
flags = ["--archive", "--exclude", ".git"]
exclude = ["*.log", "tmp/"]
```

**CLI Overrides**:
- `--skip-rsync` - Disable rsync for this worktree
- `--rsync-flags` - Override rsync flags
- `--rsync-exclude` - Add exclude patterns

### Selective Symlinks
Instead of copying certain files, create symlinks that point back to the main worktree:

**Purpose**: Share files that should be synchronized across worktrees
- `package.json` - Keep dependencies in sync
- `pnpm-lock.yaml` / `yarn.lock` - Shared lockfiles
- `.env*` - Shared environment configuration
- `tsconfig.json` - Shared TypeScript config

**Configuration**: Via `.pando.toml` or other config files
```toml
[symlink]
patterns = ["package.json", "pnpm-lock.yaml", ".env*"]
relative = true
beforeRsync = true
```

**CLI Overrides**:
- `--skip-symlink` - Disable symlink creation
- `--symlink` - Override symlink patterns
- `--absolute-symlinks` - Use absolute instead of relative paths

### Transactional Guarantees
If any post-creation step fails:
1. Remove newly created worktree (`git worktree remove --force`)
2. Clean up any partial symlinks
3. Report what failed and why
4. Suggest corrective action

Users are **never** left with broken worktrees.

### Workflow Integration
```
pando worktree add --path ../feature --branch feature
  ↓
1. Create git worktree (git worktree add)
  ↓
2. Load configuration (.pando.toml, env vars, flags)
  ↓
3. Create symlinks (if beforeRsync = true)
  ↓
4. Execute rsync (copy files from main worktree)
  ↓
5. Create symlinks (if beforeRsync = false)
  ↓
6. Validate setup
  ↓
Success! Worktree ready to use.

(On error: Rollback everything)
```

## Patterns Used

### Command Pattern
Each command is a self-contained class following oclif conventions:
- Static `description` for help text
- Static `examples` for documentation
- Static `flags` for argument parsing (using common flags from `src/utils/common-flags.ts`)
- `async run()` for execution

### Common Flags Pattern
Shared flags are centralized in `src/utils/common-flags.ts`:
```typescript
// Import common flags
import { pathFlag, jsonFlag } from '../../utils/common-flags.js'

// Use in command
static flags = {
  path: pathFlag,  // Reusable, consistent definition
  json: jsonFlag,
}
```

**Benefits**:
- Consistent flag definitions across commands
- Single source of truth for flag behavior
- Easier to update flag descriptions or defaults globally

### Config-First Initialization Pattern
Commands that use config defaults must load config before validation:
```typescript
async run() {
  // 1. Initialize git helper to get repository root
  const gitHelper = createGitHelper()
  const gitRoot = await gitHelper.getRepositoryRoot()

  // 2. Load config before validating path
  const config = await this.loadAndMergeConfig(...)

  // 3. Validate with config awareness
  const { resolvedPath } = await this.validateAndInitialize(flags, config, gitRoot)
}
```

### Delegation Pattern
Commands delegate business logic to utilities:
```typescript
// Command: CLI concerns only
const result = await gitHelper.addWorktree(flags.path, flags)
const setup = await orchestrator.setupNewWorktree(flags.path, options)

// Utilities: Business logic and operations
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
pando worktree add
// Prompts: Path? Branch?

// Scripted
pando worktree add --path ../feature-x --branch feature-x

// From specific commit
pando worktree add --path ../hotfix --branch hotfix --commit abc123

// JSON output
pando worktree add --path ../feature-x --branch feature-x --json
```

### Listing Worktrees
```typescript
// Simple list
pando worktree list

// Verbose
pando worktree list --verbose

// For scripts
pando worktree list --json | jq '.data[] | select(.branch == "main")'
```

### Removing Worktrees
```typescript
// Interactive selection (multi-select)
pando worktree remove

// Interactive selection with force flag
pando worktree remove --force

// Direct removal with path
pando worktree remove --path ../feature-x

// Force removal with path
pando worktree remove --path ../feature-x --force

// JSON output (requires --path)
pando worktree remove --path ../feature-x --json
```

### Navigating to Worktrees
```typescript
# By branch name
cd $(pando worktree navigate --branch feature-x --output-path)

# By path
cd $(pando worktree navigate --path ../feature-x --output-path)

# With shell alias
alias goto='cd $(pando worktree navigate --output-path --branch $1)'
goto feature-x
```

## Testing Approach

### Integration Tests
Use `@oclif/test` to test command behavior:
```typescript
test
  .stdout()
  .command(['worktree add', '--path', '../test', '--branch', 'test'])
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
3. ~~**Interactive Selection**~~ - ✅ Implemented in `worktree remove`
4. **Worktree Status** - Show uncommitted changes, behind/ahead status
5. ~~**Bulk Operations**~~ - ✅ Multi-select removal implemented in `worktree remove`
6. **Interactive Navigation** - Use inquirer to select worktree to navigate to

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
