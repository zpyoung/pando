---
name: pando-worktrees
description: Manage isolated Git worktrees with pando when work involves parallel subagents, Claude Code worktree isolation, separate branches, or concurrent task execution.
---

# Pando worktree lifecycle

Use pando rather than ad-hoc `git worktree` commands when creating or managing task worktrees. **Always pass `--json`** and make decisions from the structured response.

## Choose a lifecycle

- Use an **ephemeral** worktree for a parallel subagent, isolated experiment, short review, or other session-scoped task:
  `pando add <branch> --path <dir> --ephemeral --owner <session-id> --json`
- Use a **long-lived** worktree for work intended to survive sessions, such as an ongoing feature or release branch:
  `pando add <branch> --path <dir> --long-lived --owner <owner-id> --json`
- Add `--ttl <duration>` to an ephemeral worktree when the configured lifetime is unsuitable. Add `--ports` when the task needs isolated configured ports.

## Protect active work

Lock a worktree before active edits or handing it to a subagent:

```text
pando lock <path-or-branch> --reason "active task" --json
```

Unlock it when active ownership ends:

```text
pando unlock <path-or-branch> --json
```

Do not reap or remove a locked, dirty, or unmerged worktree. The plugin's session-end hook unlocks worktrees owned by that session and asks pando to reap eligible ephemeral worktrees; rely on that cleanup rather than deleting directories manually.

Inspect state with `pando list --json` and `pando health --json`. Preview cleanup with `pando reap --dry-run --json`; only after explicit approval use `pando reap --force --json` (optionally scoped with `--owner <id>`).
