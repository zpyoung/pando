# Pando Specification

## 1. Project Overview

**Pando** is a TypeScript-based CLI for managing Git worktrees with an automation-first design. It aims to make working with multiple branches simultaneously effortless for developers while providing machine-readable outputs for AI agents and CI/CD pipelines.

## 2. Core Goals

- **Effortless Worktree Management**: Simplify creation and removal of git worktrees.
- **Automation-First**: Ensure every command supports JSON output for easy integration with scripts and AI agents.
- **Developer Experience**: Provide interactive prompts, clear error messages, and "wow" aesthetics.
- **Performance**: Fast execution using TypeScript and efficient git operations.

## 3. User Stories

- **As a developer**, I want to create a new feature branch and worktree in one command so I can start coding immediately without context switching.
- **As a developer**, I want to list all my active worktrees to see what I'm working on.
- **As a developer**, I want to easily remove old worktrees to keep my workspace clean.
- **As an AI agent**, I want to query the state of worktrees in JSON format so I can understand the environment.
- **As a user**, I want to configure default paths so I don't have to type long paths every time.

## 4. Functional Requirements

### Worktree Management

- `add`: Create a new worktree, optionally checking out a new or existing branch.
- `list`: Show all worktrees with details (branch, path, commit).
- `remove`: Delete a worktree, with safety checks for uncommitted changes.

### Branch Management

- `create`: Create a branch, optionally with a worktree.
- `delete`: Delete a branch, optionally removing its worktree.

### Configuration

- Support `.pando.toml` for project-specific settings.
- Support environment variables for overrides.
- `config init`: Generate a default configuration file.
- `config show`: Display current configuration.

## 5. Non-Functional Requirements

- **Type Safety**: 100% TypeScript codebase.
- **Error Handling**: Clear distinction between validation errors (user-fixable) and operation errors (system issues).
- **Documentation**: Comprehensive `README.md` and internal `DESIGN.md` files.
