# Beads Task Management

AI-first issue tracker with dependency tracking. DB: `.beads/pando.db`, State: `.beads/issues.jsonl` (git)

## Quick Reference
```bash
bd ready --json              # Find unblocked work
bd list|show|create|close    # CRUD operations
bd update <id> --status in_progress  # Claim task
bd sync                      # Git sync (run at session end)
```

**Prefix**: `pando-` (e.g., `pando-1`, `pando-2`)

## Workflow
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

## Dependency Types
- `blocks`: Hard blocker
- `related`: Soft link
- `parent-child`: Epic/subtask
- `discovered-from`: Links to parent task

## MCP Tools
```python
mcp__plugin_beads_beads__set_context(workspace_root="/path")  # First!
mcp__plugin_beads_beads__ready|list|show|create|update|close|stats|blocked()
```

## Lifecycle
`open → in_progress → closed` (can go to `blocked` from any state)

## AI Session Checklist

### Session Start
1. `bd ready --json` - find work
2. `bd update <id> --status in_progress` - claim

### During Work
- Track discoveries: create issues with `discovered-from`
- Add comments for progress notes

### Session End
1. `bd close <id> --reason "msg"` - complete tasks
2. `bd sync` - commit to git
