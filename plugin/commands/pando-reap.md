---
description: Preview and optionally reap expired pando worktrees
---

Run `pando reap --dry-run --json` and summarize the worktrees that would be reaped, plus anything skipped and each safety reason. If there are eligible worktrees, ask for explicit confirmation before taking action. Only after confirmation run `pando reap --force --json`, then summarize the structured result. Never omit `--json` and never run the force command without approval.
