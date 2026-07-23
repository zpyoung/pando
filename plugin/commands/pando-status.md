---
description: Show pando worktree lifecycle and repository health status
---

Run `pando list --json` and `pando health --json` from the current repository. Parse the JSON responses and summarize each worktree's path/branch, kind, age, lock state, and owner. Then report health warnings or errors and call out ephemeral worktrees that appear stale. Do not use non-JSON pando commands and do not change repository state.
