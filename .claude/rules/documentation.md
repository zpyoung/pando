# Documentation Rules

**Auto-update docs with code changes** - don't ask, just do it.

## What to Update

| Change Type | Update |
|-------------|--------|
| User-facing behavior | README.md |
| Architecture changes | ARCHITECTURE.md |
| Module add/modify | DESIGN.md in folder |
| Project patterns | CLAUDE.md |

## When to Create Docs

| File | Create When |
|------|-------------|
| ARCHITECTURE.md | Major dirs, 5+ files, 3+ subdirs, new patterns |
| DESIGN.md | Feature dirs 2+ files, utility modules, complex algorithms |
| README.md | User-facing commands, installation changes |

**Skip docs for**: test dirs, single-file dirs, type-only folders, build/config dirs

## Doc Templates (Condensed)

**ARCHITECTURE.md**: Overview → Components → Pattern → Dependencies → Data Flow → Extension Points → Decisions

**DESIGN.md**: Purpose → Files Overview → Design Decisions → Patterns → Dependencies → Usage → Future

## Enforcement
- **MUST**: Update affected docs automatically, create DESIGN.md for new feature dirs
- **SHOULD**: Flag stale docs, suggest improvements proactively

## Spec-Driven Development (SDD)

### Core Files (`ai-docs/`)
- `SPEC.md`: Goals/stories (start here)
- `PLAN.md`: Architecture
- `TASKS.md`: Checklist
- `CONTEXT.md`: Glossary
- `LESSONS.md`: Patterns to keep/avoid

### Workflow
1. **Before code**: Update `SPEC.md` + `PLAN.md`
2. **Define work**: Break into `TASKS.md`
3. **Implement**: Execute tasks incrementally
4. **Validate**: `pnpm ai:validate` (checks doc sync)
5. **Refresh**: `pnpm ai:context` (regenerates `llm.txt`)
