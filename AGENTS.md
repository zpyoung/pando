# Pando Maintainer Instructions

This repository is maintained through the `pando` Hermes profile. These instructions are project-local law for AI agents and maintainer automation.

## Project identity

- Repo: `zpyoung/pando`
- Workspace: `/opt/data/pando`
- Default branch: `main`
- Purpose: TypeScript/oclif CLI for Git worktree management with automation-first JSON output.

## Maintainer workflow

- Start by reading the issue/PR body, comments, and acceptance criteria before editing.
- Work on a branch or isolated worktree; do not push directly to `main` for non-trivial changes.
- Keep PRs focused and update the PR body when the final diff changes.
- Prefer tests first for production code when feasible.
- Verify before reporting completion; include exact commands and outcomes.

## Local verification

Run the relevant checks before opening or updating a PR:

- `pnpm run validate`
- `pnpm run build`

If a check is not applicable, state why and provide the best available substitute.

## Documentation and planning surfaces

- Durable docs/surfaces: README.md, ARCHITECTURE.md, DESIGN.md, ai-docs/, CLAUDE.md, Beads task DB under .beads/
- Issues are executable work packets: Goal, Scope, Acceptance criteria.
- PRs are review surfaces: summary, verification, linked issue(s), and risks.

## Boundaries

Autonomous/reviewable:

- Local edits, tests, branches, commits, PR creation/updates, issue comments/labels, docs updates.

Ask Zach first:

- Publishing/releases, production/live settings, destructive operations, force-pushes to shared branches, credentials/auth, unclear product decisions, or irreversible public-impact changes.

## Project-specific cautions

- Preserve automation-first `--json` behavior and error shape for CLI commands.
- Use strict TypeScript; avoid `any` and keep command/business logic separated.
- Prefer `pnpm run validate` before PR; package publishing/Homebrew release needs Zach approval.
