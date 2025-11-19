# Pando Domain Context

## Glossary

- **Worktree**: A linked copy of the git repository that allows checking out a different branch. Pando manages these to allow parallel development.
- **Main Worktree**: The primary directory where the repo was cloned. Contains the `.git` directory.
- **Linked Worktree**: Additional worktrees created via `git worktree add`. They reference the main worktree's object database.
- **Pando**: The CLI tool this project implements.
- **Beads**: A task management system integrated into the project (files in `.beads/`).

## Key Constraints

- **Symlinks**: Pando supports symlinking files (like `.env`, `node_modules`) from the main worktree to linked worktrees to save space and setup time.
- **JSON Output**: ALL commands must support `--json` for automation.
- **Error Handling**: Must distinguish between `validation` (user error) and `operation` (system error) to avoid showing stack traces to users for simple mistakes.

## Directory Structure

- `src/commands/`: CLI command implementations.
- `src/utils/`: Shared logic and git wrappers.
- `ai-docs/`: Spec-Driven Development files (`SPEC.md`, `PLAN.md`, etc.).
