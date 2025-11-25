# Config Commands Design

## Purpose

The `config` commands allow users to manage their Pando configuration, including initializing a default configuration file and viewing the current configuration state.

## Files in This Module

- `init.ts`: Command to generate a `.pando.toml` configuration file.
- `show.ts`: Command to display the current configuration (merged from file and env vars).

## Implementation Approach

- **Init**: Intelligent config file creation with merge support:
  - If no config exists: Creates new file with all defaults
  - If config exists (default): Merges missing defaults into existing config, preserving user customizations
  - `--force`: Overwrites existing file completely
  - `--no-merge`: Errors if file exists (old behavior)
  - JSON output includes what was added during merge
- **Show**: Uses the shared `ConfigLoader` utility to resolve the final configuration and prints it. Supports `--json` for machine readability.

## Key Functions/Classes

- `InitConfig`: Extends `Command`. Handles the creation of `.pando.toml`.
- `ShowConfig`: Extends `Command`. Handles the display of resolved configuration.

## Dependencies

- `@oclif/core`: Command framework.
- `fs-extra`: File system operations.
- `../../config/loader`: `ConfigLoader` for resolving configuration.

## Usage Examples

```bash
# Initialize config (creates new or merges missing defaults)
pando config init

# Force overwrite existing config
pando config init --force

# Error if config exists (disable merge)
pando config init --no-merge

# Initialize global config
pando config init --global

# Show current config
pando config show
pando config show --json

# Show what was added during merge
pando config init --json
# Output: {"status":"success","action":"merged","added":[{"path":"worktree.rebaseOnAdd","value":true}],"addedCount":1}
```

## Testing Approach

- **Integration Tests**: Verify that `init` creates the file and `show` outputs the expected values.
- **Mocking**: Mock `fs-extra` to avoid writing to disk during tests.

## Future Improvements

- Add `config set <key> <value>` command to modify config via CLI.
- Add validation for config values during `init`.
