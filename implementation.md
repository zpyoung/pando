# Project Implementation Document: `pando`

## Overview

`pando` is a TypeScript-based command-line interface for managing Git worktrees, built with oclif and simple-git. It is designed for robust automation, AI agent integration, and modern developer workflows. The application enables effortless multi-branch development, clear worktree organization, and scriptable workflows for both humans and agents.

***

## Project Goals

- Offer streamlined CLI control over git worktree lifecycle (create, list, remove, navigate)
- Provide scriptable, flag-driven commands to support both interactive use and agent automation
- Ensure maintainable, strongly-typed, and extensible project structure
- Output developer-friendly messages and support machine-readable (JSON) output
- Integrate with common developer tools and editors for smooth navigation

***

## Core Features & Workflows

**Worktree Management**
- Add: Create new worktrees from branches/commits (`pando worktree:add`)
- List: Show all worktrees with metadata (`pando worktree:list`)
- Remove: Detach and clean up worktrees (`pando worktree:remove`)
- Navigate: Output directory hints or navigation commands (`pando worktree:navigate`)

**Branch Utilities**
- Create/Delete branches
- Map branches to worktree status

**Interactive UX**
- Use interactive prompts (inquirer) for path/branch selection if not provided as flags
- Fuzzy matching and autocompletion for worktree/branch names

**Automation and Integration**
- Every command is fully flag-driven and scriptable
- Optional JSON output mode for agent ingestion
- Modular, easily extensible code organization

***

## Architecture & Technology Stack

| Layer         | Tech / Library           | Purpose                                 |
|---------------|-------------------------|------------------------------------------|
| CLI Framework | oclif + TypeScript      | Command scaffolding, flag parsing        |
| Git Adapter   | simple-git              | Easy, Promise-based git API              |
| Output        | chalk, ora, inquirer    | Terminal coloring, spinners, prompts     |
| Testing       | oclif/test, Vitest      | CLI tests and stdio assertions           |
| Builder       | ts-node, TypeScript     | Fast iteration and strict typing         |

***

## Project Structure

```
pando/
├── package.json
├── tsconfig.json
├── src/
│   ├── commands/
│   │   ├── worktree/
│   │   │   ├── add.ts
│   │   │   ├── list.ts
│   │   │   ├── remove.ts
│   │   │   └── navigate.ts
│   │   └── branch/
│   │       ├── create.ts
│   │       └── delete.ts
│   ├── utils/
│   │   └── git.ts
│   └── index.ts
├── test/
│   ├── commands/
│   │   ├── worktree/
│   │   │   ├── add.test.ts
│   │   │   ├── list.test.ts
│   │   │   └── remove.test.ts
│   └── setup.ts
```

***

## Key Dependencies

- `@oclif/core`
- `simple-git`
- `typescript`, `ts-node`
- `chalk`
- `inquirer`
- `ora`
- `@oclif/test`, `vitest`

***

## Implementation Example

**Worktree Add Command**

`src/commands/worktree/add.ts`
```typescript
import { Command, Flags } from '@oclif/core'
import simpleGit from 'simple-git'

export default class AddWorktree extends Command {
  static description = 'Add a new git worktree'
  static flags = {
    path: Flags.string({ required: true, description: 'Path for new worktree' }),
    branch: Flags.string({ required: false, description: 'Branch to checkout/create' }),
    commit: Flags.string({ required: false, description: 'Commit for new branch' }),
    json: Flags.boolean({ description: 'Output in JSON format' }),
  }

  async run() {
    const { flags } = await this.parse(AddWorktree)
    const git = simpleGit()
    let addArgs = [flags.path]
    if (flags.branch) addArgs.push(flags.branch)
    if (flags.commit) addArgs.push(flags.commit)
    await git.raw(['worktree', 'add', ...addArgs])
    if (flags.json) {
      this.log(JSON.stringify({ path: flags.path, branch: flags.branch || null }))
    } else {
      this.log(`Worktree created at: ${flags.path}`)
    }
  }
}
```

***

## Example Workflows

- Add a feature worktree  
  `pando worktree:add --path ../feature-x --branch feature-x`
- List all  
  `pando worktree:list`
- Remove  
  `pando worktree:remove --path ../feature-x`
- Output JSON for agent  
  `pando worktree:list --json`

***

## Testing

- Use `@oclif/test` for running each CLI command and validating the output
- Mock `simple-git` for unit, use temp dirs for integration tests
- Example:
```typescript
import {expect, test} from '@oclif/test'
describe('worktree:add', () => {
  test
    .stdout()
    .command(['worktree:add', '--path', '../feature-x', '--branch', 'feature-x'])
    .it('creates a new worktree', ctx => {
      expect(ctx.stdout).to.contain('Worktree created at:')
    })
})
```

***

## AI Agent Context

- All `pando` commands are fully composable via flags
- Use `--json` flag for agent parsing or workflow engines
- Modular organization enables adding new commands (files in `src/commands`)

***

## Extensibility & Roadmap

- Add fuzzy/fuzzy autocomplete for names
- Enhance for remote repo operations and editor integrations
- Logging/telemetry plugins
- Custom AI workflow hooks

***

## References

- oclif documentation and project templates[1][2][4][5][8]
- oclif/TypeScript CLI setup and project structure[3][6][7]

***

This document is ready for use as an artifact for your `pando` project implementation.

[1](https://oclif.github.io/docs/templates/)
[2](https://oclif.github.io/docs/introduction/)
[3](https://www.joshcanhelp.com/oclif/)
[4](https://github.com/oclif/core)
[5](https://oclif.github.io/docs/features/)
[6](https://codecryrepeat.hashnode.dev/learn-how-to-create-a-beautiful-cli-application-with-the-oclif-and-clackprompts)
[7](https://oclif.github.io)
[8](https://oclif.github.io/docs/generator_commands/)
[9](https://engineering.salesforce.com/open-sourcing-oclif-the-cli-framework-that-powers-our-clis-21fbda99d33a/)