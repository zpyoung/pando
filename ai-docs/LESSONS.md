# Pando Lessons & Patterns

## Patterns That Work

### 1. Facade Pattern for Git

**Description**: Wrapping `simple-git` in a `GitHelper` class.
**Why**: Allows us to normalize errors, add logging, and mock git operations easily in tests.

### 2. Config-First Initialization

**Description**: Loading configuration before validating command arguments.
**Why**: Allows defaults (like `defaultPath`) to be applied, reducing the need for user arguments.

### 3. Strict Type Separation

**Description**: Defining interfaces like `WorktreeInfo` separately from the implementation.
**Why**: Ensures data structures are consistent across the application and easy to mock.

## Patterns to Avoid

### 1. Direct `console.log` for Errors

**Description**: Using `console.error` or `console.log` for errors.
**Why**: Bypasses the `ErrorHelper` and inconsistent with the `--json` output requirement.
**Better Approach**: Use `ErrorHelper.validation()` or `ErrorHelper.operation()`.

### 2. Logic in Command Classes

**Description**: Putting complex business logic inside the `run()` method of a command.
**Why**: Harder to test and reuse.
**Better Approach**: Move logic to `src/utils/` and keep commands as thin controllers.
