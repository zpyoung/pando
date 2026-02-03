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

### Enhancement: Worktree Health Check
**Priority:** High | **Effort:** Low | **Tags:** enhancement, ai-proposed

New command: `pando health` (or `pando status`)

Shows at a glance:
- Which worktrees have uncommitted changes
- Which branches are behind their upstream
- Which worktrees point to gone/missing directories
- Stale worktrees (merged branches, gone remotes)

**Example output:**
```
Worktree Health Report
======================

🚨 Uncommitted changes:
  - feature/auth (2 files modified)

⚠️  Behind upstream:
  - feature/payments (3 commits behind main)

✅ All good:
  - main
  - develop
  - feature/ui-refresh
```

**JSON output:**
```json
{
  "uncommitted": [{"path": "../feature/auth", "files": 2}],
  "behind": [{"path": "../feature/payments", "commits": 3, "target": "main"}],
  "clean": ["../main", "../develop", "../feature/ui-refresh"]
}
```

**Implementation:**
- Reuse existing GitHelper methods (hasUncommittedChanges, getBranchStatus)
- Add new command `src/commands/health.ts`
- Simple status aggregation and formatting

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
- **Integration hooks** - pre/post commands via config
- **Performance dashboard** - operation timing and optimization suggestions

## Completed

- *AI First Transformation sprint* (2026-02-03)
