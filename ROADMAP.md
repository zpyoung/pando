# Pando Roadmap

## Active Issues

### Enhancement: Fuzzy Branch Name Matching
**Priority:** Medium | **Effort:** Medium | **Tags:** enhancement, ai-proposed

Currently, branch names must match exactly when creating worktrees. This is friction—especially for long branch names.

**Proposal:**
- Add `--fuzzy` flag to `pando add` command
- Use fuzzy string matching to find similar branch names
- Show top 3-5 matches when multiple candidates exist
- Fall back to existing behavior if no close match found

**User benefit:**
`pando add --path ../auth --branch authentication-flow-v3`
→ If no exact match, suggest: `authentication-flow-v3-fix`, `auth-flow-v3`, `authentication-flow-v2`

**Implementation:**
- Use `fast-levenshtein` or similar fuzzy matching library
- Score branches by edit distance + common prefixes
- Add tests for matching edge cases

---

### Enhancement: Smart Branch Suggestions
**Priority:** Low | **Effort:** Medium | **Tags:** enhancement, ux, ai-proposed

When creating a new worktree, suggest related branches based on:
- Current branch name (prefixes like `feature/`, `fix/`)
- Recent branches worked on
- Branches with similar commit history

**Use case:**
```bash
$ pando add --path ../auth

No branch specified. Found similar branches:
  1. feature/auth (most recent)
  2. fix/auth-bug (3 days old)
  3. feature/authentication (1 week old)

Select branch or type new name: _
```

**Implementation:**
- Track branch history in local cache
- Heuristic matching on branch names
- Integrate into existing interactive prompts

---

## Backlog Ideas

- **Remote repository operations** (from TASKS.md)
- **Worktree templates** - pre-populated structure for new branches
- **Batch operations** - `pando add-many` from a list
- **Conflict detection** - warn before creating worktree if conflicts likely
- **Performance dashboard** - operation timing and optimization suggestions
- **Shell completion** - tab completion via `@oclif/plugin-autocomplete`
- **Trust-store realpath canonicalization** - canonicalize config paths (resolve
  symlinks) before keying the post-command trust store, as a residual hardening
  follow-up

## Completed

- **Worktree Health Check** - `pando health` command (2026-06-09)
- **Integration hooks** - pre/post commands via config (`[postCommands]`) (2026-06-09)
- *AI First Transformation sprint* (2026-02-03)
