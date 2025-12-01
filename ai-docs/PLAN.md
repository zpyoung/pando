# Pando Technical Plan

## 1. Architecture Overview

Pando uses a modular, command-oriented architecture based on the **oclif** framework.

- **Language**: TypeScript
- **Core Libraries**: `simple-git` (git operations), `inquirer` (prompts), `chalk` (styling).

## 2. Component Design

### Command Layer (`src/commands/`)

- Handles user interaction, argument parsing, and output formatting.
- Delegates business logic to the Utility Layer.
- **Pattern**: Command Pattern (each command is a class).

### Utility Layer (`src/utils/`)

- **GitHelper**: Facade for `simple-git` operations.
- **ErrorHelper**: Centralized error handling (validation vs operation errors).
- **ConfigLoader**: Manages `.pando.toml` and environment variables.

## 3. Data Flow

1. **Input**: User runs command -> `oclif` parses flags.
2. **Validation**: Command validates inputs (e.g., path existence).
3. **Execution**: Command calls `GitHelper` methods.
4. **Output**: Command formats result (JSON or human-readable) and prints to stdout.

## 4. Current Status

- [x] Basic worktree commands (add, list, remove)
- [x] Basic branch commands (create, delete)
- [x] Configuration support
- [ ] AI Context generation scripts (In Progress)
- [ ] Documentation coverage enforcement (In Progress)
