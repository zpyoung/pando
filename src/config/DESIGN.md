# Configuration System Design

## Purpose

This module provides a comprehensive configuration system for pando that supports multiple file formats, project types, and priority-based merging. It enables users to configure rsync and symlink behavior at the project or global level.

## Files Overview

- **schema.ts** - Configuration schemas, TypeScript interfaces, Zod validation
- **loader.ts** - Multi-file configuration discovery, parsing, and merging
- **env.ts** - Environment variable parser (PANDO_* prefix)

## Key Design Decisions

### Multi-File Support
**Chosen**: Support 6+ configuration file formats
**Rationale**:
- Different projects use different ecosystems
- Python projects have pyproject.toml
- Rust projects have Cargo.toml
- Node.js projects have package.json
- Universal .pando.toml for any project type

**Supported Files**:
1. `.pando.toml` - Dedicated config (highest priority)
2. `pyproject.toml` → `[tool.pando]` section
3. `Cargo.toml` → `[package.metadata.pando]` section
4. `package.json` → `"pando"` key
5. `deno.json` → `"pando"` key
6. `composer.json` → `"extra.pando"` section
7. `~/.config/pando/config.toml` - Global config

### TOML as Primary Format
**Chosen**: TOML for all .toml files, JSON for .json files
**Rationale**:
- TOML is designed for configuration
- More readable than JSON for humans
- Better comments support
- Standard in Rust and Python ecosystems

### Configuration Schema

**Supported Configuration Sections**:

1. **`[rsync]`** - Controls file copying to new worktrees
   - `enabled` (boolean) - Enable/disable rsync
   - `flags` (array) - Rsync command flags
   - `exclude` (array) - Patterns to exclude from sync

2. **`[symlink]`** - Controls selective symlinking
   - `patterns` (array) - Glob patterns for files to symlink
   - `relative` (boolean) - Use relative vs absolute symlinks
   - `beforeRsync` (boolean) - Create symlinks before or after rsync

3. **`[worktree]`** - Worktree defaults (NEW)
   - `defaultPath` (string, optional) - Default parent directory for worktrees
     - Relative paths resolve from git repository root
     - Absolute paths used as-is
     - When used with `--branch` flag, branch name is appended

**Example Configuration**:
```toml
[rsync]
enabled = true
flags = ["--archive", "--exclude", ".git"]
exclude = ["dist/", "node_modules/"]

[symlink]
patterns = ["package.json", ".env*"]
relative = true
beforeRsync = true

[worktree]
defaultPath = "../worktrees"
```

### Priority-Based Merging
**Configuration Discovery Order** (highest to lowest priority):
```
1. CLI flags (--rsync-flags, --symlink, --path, etc.)
2. Environment variables (PANDO_*)
3. .pando.toml (current directory)
4. Project files (walk up to git root):
   - pyproject.toml [tool.pando]
   - Cargo.toml [package.metadata.pando]
   - package.json "pando"
   - deno.json "pando"
   - composer.json "extra.pando"
5. ~/.config/pando/config.toml (global)
6. Built-in defaults
```

**Merge Strategy**:
- Higher priority completely overrides lower priority
- Arrays are replaced, not concatenated
- Objects are deep merged
- Source tracking for debugging

### Validation with Zod
**Chosen**: Zod for schema validation
**Rationale**:
- TypeScript-first design
- Runtime validation
- Excellent error messages
- Type inference from schemas

## Patterns Used

### Schema-Driven Development
Define schema first, infer types:
```typescript
const schema = z.object({
  rsync: RsyncConfigSchema,
  symlink: SymlinkConfigSchema,
})

type Config = z.infer<typeof schema>
```

### Parser Dispatcher Pattern
Single entry point dispatches to file-specific parsers:
```typescript
switch (configFile.source) {
  case ConfigSource.PANDO_TOML:
    return parsePandoToml(path)
  case ConfigSource.PYPROJECT_TOML:
    return parsePyprojectToml(path)
  // ...
}
```

### Caching for Performance
Load once, cache result:
```typescript
class ConfigLoader {
  private cache: Map<string, Config> = new Map()

  async load(options) {
    if (!options.skipCache && this.cache.has(key)) {
      return this.cache.get(key)
    }
    // Load and cache
  }
}
```

## Dependencies

### External
- `@iarna/toml` - TOML parsing
- `zod` - Schema validation
- `fs-extra` - Enhanced file operations

### Internal
- None (config is the foundation layer)

## Usage Examples

### Load Configuration
```typescript
import { loadConfig } from './config/loader'

const config = await loadConfig({
  cwd: process.cwd(),
  gitRoot: '/path/to/repo'
})

console.log(config.rsync.enabled) // true
console.log(config.symlink.patterns) // ['package.json']
```

### Load with Source Tracking
```typescript
import { configLoader } from './config/loader'

const result = await configLoader.loadWithSources({
  cwd: process.cwd(),
  gitRoot: '/path/to/repo'
})

console.log(result.config) // Merged config
console.log(result.sources) // Where each setting came from
```

### Parse Environment Variables
```typescript
import { getEnvConfig } from './config/env'

// With PANDO_RSYNC_ENABLED=false in environment
const envConfig = getEnvConfig()
console.log(envConfig.rsync?.enabled) // false
```

### Validate Configuration
```typescript
import { validateConfig } from './config/schema'

try {
  const validated = validateConfig(userConfig)
  // Use validated config
} catch (error) {
  // Handle validation errors
  console.error(error.issues)
}
```

## Testing Approach

### Unit Tests
- Test each parser independently
- Test config merging with various priority scenarios
- Test environment variable parsing
- Test schema validation with valid/invalid inputs

### Integration Tests
- Test full config loading with real files
- Test directory walking to git root
- Test caching behavior
- Test error handling for malformed files

## Error Handling

### Parse Errors
- Gracefully handle malformed TOML/JSON
- Log warning and skip file
- Continue with other config sources

### Validation Errors
- Provide detailed Zod error messages
- Show which file had the error
- Suggest fixes

### Missing Files
- Silently skip missing optional files
- Only error if no config found anywhere

## Future Considerations

### Planned Features
1. **Schema Versioning** - Support config format versions
2. **Config Migration** - Auto-upgrade old configs
3. **Config Validation Command** - `pando config:validate`
4. **Watch Mode** - Auto-reload on config changes
5. **Merge Strategies** - Allow array concatenation vs replacement

### Additional File Formats
- `.pando.json` - JSON alternative to TOML
- `.pando.yaml` - YAML support
- `.pando.js` - JavaScript config with logic

### Environment Variable Enhancements
- Support for nested objects: `PANDO_RSYNC__FLAGS__0=--archive`
- Support for JSON values: `PANDO_RSYNC_CONFIG='{"enabled":true}'`

## Related Documentation

- [Root ARCHITECTURE.md](../../ARCHITECTURE.md) - System architecture
- [Root DESIGN.md](../../DESIGN.md) - High-level design decisions
- [.pando.toml.example](../../.pando.toml.example) - Example configuration
