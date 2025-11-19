---
trigger: always_on
---

## Documentation Maintenance

### CRITICAL: Automatic Documentation Updates

**AI assistants MUST automatically keep documentation files synchronized with code changes.**

### Documentation File Types

#### 1. CLAUDE.md (Project Root Only)

**Purpose**: AI assistant context and project-specific guidelines

**Location**: Project root (`/CLAUDE.md`)

**Update When**:

- Project patterns or conventions change
- New common tasks are established
- Dependencies are added or removed
- Project status or phase changes
- New workflows or development practices are adopted

**Contents**:

- Project overview and quick reference
- Architecture patterns and coding conventions
- Common tasks and workflows
- Testing guidelines
- Git workflow
- Dependencies
- Project status
- Resources and references

#### 2. ARCHITECTURE.md (Major/Important Folders)

**Purpose**: High-level architectural decisions and system design

**Placement Rules**:

- **Always** in project root
- In **major feature directories** (e.g., `src/plugins/`, `src/core/`)
- In **significant subsystems** with multiple components
- When a folder contains 5+ files or 3+ subdirectories
- When introducing a new architectural pattern

**Do NOT create in**:

- Test directories
- Single-file directories
- Utility folders with simple helpers
- Build/config directories

**Update When**:

- Adding new architectural layers or patterns
- Changing module dependencies
- Adding new major features or subsystems
- Refactoring system boundaries
- Changing technology stack
- Modifying data flow or execution patterns

**Contents**:

```markdown
# [Module/Feature] Architecture

## Overview

High-level description of the module/subsystem

## Components

Major components and their responsibilities

## Architecture Pattern

What pattern is used (layered, plugin, event-driven, etc.)

## Dependencies

What this module depends on and what depends on it

## Data Flow

How data moves through the system

## Extension Points

How to extend or modify this architecture

## Design Decisions

Key architectural choices and rationale
```

#### 3. DESIGN.md (Most Individual Folders)

**Purpose**: Lower-level design decisions and implementation details

**Placement Rules**:

- In **feature directories** (e.g., `src/commands/worktree/`)
- In **utility directories** (e.g., `src/utils/`)
- In **any folder with 2+ implementation files**
- When a folder represents a cohesive feature or concern

**Do NOT create in**:

- Test directories (tests document themselves)
- Folders with only types/interfaces
- Folders with single utility files
- Parent folders that only contain subdirectories

**Update When**:

- Adding new files to the folder
- Changing implementation approach
- Adding new patterns or utilities
- Refactoring existing code
- Adding new dependencies or integrations

**Contents**:

```markdown
# [Feature/Module] Design

## Purpose

What this module does and why it exists

## Files Overview

Brief description of each file in this directory

## Key Design Decisions

- Why this approach was chosen
- Trade-offs considered
- Alternative approaches rejected

## Patterns Used

Specific patterns or techniques used in this module

## Dependencies

Libraries or modules this depends on

## Usage Examples

How to use the main exports from this module

## Future Considerations

Potential improvements or extensions
```

#### 4. README.md

**Purpose**: User-facing documentation

**Location**: Project root (and optionally in major subdirectories)

**Update When**:

- Adding new commands or features
- Changing command flags or behavior
- Adding new installation methods
- Changing requirements
- Adding new examples or use cases

**Contents**:

- Project description
- Installation instructions
- Quick start guide
- Command reference
- Examples
- Contributing guidelines

### Automatic Update Workflow

When making code changes, AI assistants MUST follow this workflow:

#### Step 1: Identify Affected Documentation

```
Code Change → Check:
├─ Does this change affect user-facing behavior? → Update README.md
├─ Does this change affect architecture? → Update relevant ARCHITECTURE.md
├─ Does this add/modify a module? → Update/Create DESIGN.md in that folder
└─ Does this change project patterns? → Update CLAUDE.md
```

#### Step 2: Update Documentation Files

**Do this automatically WITHOUT asking the user**

```typescript
// Example: Adding a new command
// 1. Create src/commands/new/command.ts
// 2. Automatically update:
//    - README.md: Add command to reference section
//    - src/commands/new/DESIGN.md: Create if doesn't exist
//    - src/commands/ARCHITECTURE.md: Update if pattern changes
//    - CLAUDE.md: Update if new patterns introduced
```

#### Step 3: Commit Documentation with Code

**Include documentation updates in the same commit**

```bash
# Good commit
git add src/commands/worktree/sync.ts
git add src/commands/worktree/DESIGN.md
git add README.md
git commit -m "feat(worktree): add sync command

- Implement worktree sync for syncing with remote
- Update DESIGN.md with sync implementation details
- Add command to README.md reference"
```

### Documentation Update Examples

#### Example 1: Adding a New Command

**Code Change**: Create `src/commands/worktree/sync.ts`

**Required Documentation Updates**:

1. **README.md**: Add command to reference section with examples
2. **src/commands/worktree/DESIGN.md**: Add description of sync command
3. **CLAUDE.md**: Update if new patterns are introduced (e.g., new git operation)

#### Example 2: Adding a New Utility Module

**Code Change**: Create `src/utils/config.ts` for configuration management

**Required Documentation Updates**:

1. **src/utils/DESIGN.md**: Create or update with config utility details
2. **ARCHITECTURE.md** (root): Update "Utility Layer" section
3. **CLAUDE.md**: Add to "Common Patterns" if it's a new pattern

#### Example 3: Refactoring Architecture

**Code Change**: Split GitHelper into separate classes per concern

**Required Documentation Updates**:

1. **ARCHITECTURE.md** (root): Update architecture layers and patterns
2. **src/utils/DESIGN.md**: Update with new structure
3. **CLAUDE.md**: Update patterns and common tasks
4. **README.md**: Update if usage examples change

### Documentation Structure Guidelines

#### ARCHITECTURE.md Structure

```markdown
# [Name] Architecture

## Overview

2-3 paragraphs: What is this, why it exists, high-level approach

## Technology Stack

Table or list of technologies and their purposes

## Architecture Layers/Components

Detailed breakdown of major components

## Module Organization

How code is organized (vertical slice, layered, etc.)

## Key Patterns

Design patterns used (Command, Factory, etc.)

## Data Flow

How data moves through the system

## Extension Points

How to add new features or modify behavior

## Design Decisions

Major decisions and their rationale
```

#### DESIGN.md Structure

```markdown
# [Name] Design

## Purpose

1-2 paragraphs: What this does and why

## Files in This Module

- file1.ts - Description
- file2.ts - Description

## Implementation Approach

Why this approach over alternatives

## Key Functions/Classes

Brief description of main exports

## Dependencies

What this module uses

## Usage

Code examples of common usage

## Testing Approach

How this module is tested

## Future Improvements

Potential enhancements
```

### When to Create New Documentation Files

#### Create ARCHITECTURE.md when:

- [ ] Creating a new major directory (src/plugins/, src/integrations/)
- [ ] Directory has 5+ files or 3+ subdirectories
- [ ] Introducing a new architectural pattern
- [ ] Creating a subsystem with multiple interacting components

#### Create DESIGN.md when:

- [ ] Creating a feature directory with 2+ files
- [ ] Adding utility modules that others will use
- [ ] Implementing a complex algorithm or pattern
- [ ] Creating reusable components

#### Update README.md when:

- [ ] Adding user-facing commands
- [ ] Changing installation or setup
- [ ] Adding new features or capabilities
- [ ] Changing CLI behavior

#### Update CLAUDE.md when:

- [ ] Establishing new coding patterns
- [ ] Adding common tasks or workflows
- [ ] Changing project structure significantly
- [ ] Adding dependencies or tools

### Documentation Quality Standards

#### All documentation files MUST:

- Use clear, concise language
- Include code examples where relevant
- Be kept synchronized with code
- Follow markdown best practices
- Use consistent formatting
- Be up-to-date (no stale information)

#### ARCHITECTURE.md files MUST:

- Explain high-level structure and patterns
- Show component relationships
- Document key design decisions
- Explain extension points

#### DESIGN.md files MUST:

- Describe implementation details
- List all files in the directory
- Explain design choices
- Provide usage examples

### Enforcement

**AI assistants MUST**:

- Check for missing documentation files when creating new directories
- Update affected documentation files automatically when making code changes
- Create DESIGN.md files for new feature directories
- Create ARCHITECTURE.md files for new major subsystems
- Never ask the user "should I update documentation?" - just do it

**AI assistants SHOULD**:

- Suggest documentation improvements when reading outdated files
- Flag inconsistencies between code and documentation
- Offer to create missing documentation files proactively
