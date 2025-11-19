# Config Commands Design

## Purpose

The `config` commands allow users to manage their Pando configuration, including initializing a default configuration file and viewing the current configuration state.

## Files in This Module

- `init.ts`: Command to generate a `.pando.toml` configuration file.
- `show.ts`: Command to display the current configuration (merged from file and env vars).

## Implementation Approach

- **Init**: Checks if a config file already exists to prevent accidental overwrites. Uses `fs-extra` to write a template TOML file.
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
# Initialize config
pando config init

# Show current config
pando config show
pando config show --json
```

## Testing Approach

- **Integration Tests**: Verify that `init` creates the file and `show` outputs the expected values.
- **Mocking**: Mock `fs-extra` to avoid writing to disk during tests.

## Future Improvements

- Add `config set <key> <value>` command to modify config via CLI.
- Add validation for config values during `init`.
