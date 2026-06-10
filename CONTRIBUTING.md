# Contributing to Pando

Thanks for your interest in contributing! Pando is a TypeScript CLI for managing
Git worktrees, built on [oclif](https://oclif.io) and
[simple-git](https://github.com/steveukx/git-js).

## Prerequisites

- **Node.js 20** — the project pins Node 20 via the `.node-version` file. The
  published package supports Node >= 18, and CI also runs the test matrix on
  Node 18, 20, and 22, but Node 20 is the recommended development version.
- **pnpm** — the package manager for this repo (`packageManager` is pinned in
  `package.json`). Install with `npm install -g pnpm` or via
  [corepack](https://nodejs.org/api/corepack.html).
- **Git >= 2.5.0** — required for worktree support.
- **Docker** — only needed to run the end-to-end (E2E) test suites locally.
- **rsync** — optional, used by Pando's file-sync features and exercised by some
  tests.

## Setup

```bash
git clone https://github.com/zpyoung/pando.git
cd pando
pnpm install
pnpm build
```

To run your local build as the `pando` command:

```bash
pnpm link --global
```

## Development Loop

Run the CLI directly from TypeScript source without rebuilding:

```bash
# pnpm dev <command> [flags]
pnpm dev list
pnpm dev add --path ../feature-x --branch feature-x
pnpm dev health --json
```

Other useful scripts:

```bash
pnpm build          # Compile TypeScript to dist/
pnpm test           # Vitest in watch mode (interactive dev; use test:run for one-shot)
pnpm test:run       # Run the unit test suite once (non-interactive)
pnpm test:watch     # Vitest in explicit watch mode
pnpm test:coverage  # Run tests with coverage report
pnpm lint           # ESLint
pnpm format         # Prettier (write)
pnpm typecheck      # tsc --noEmit
```

## Quality Gates

Before opening a pull request, make sure the full validation suite passes:

```bash
pnpm validate
```

`pnpm validate` runs `format:check`, `lint`, `typecheck`, and `test:run`. The
project also enforces coverage thresholds on the unit-test run.

### End-to-end tests (Docker required)

E2E tests run against real git repositories inside containers, so Docker must be
running:

```bash
pnpm test:e2e             # Docker-based E2E suite
pnpm test:e2e:published   # E2E against the published npm package
pnpm test:all             # Unit + E2E
```

When running E2E tests through Vitest directly, allow extra time for container
startup with `--hookTimeout=60000`.

## Conventional Commits

Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/)
format:

```
<type>(<scope>): <subject>
```

Common types: `feat`, `fix`, `docs`, `test`, `chore`, `ci`, `refactor`. Examples:

```
feat(add): support post-command scripts
fix(health): correct behind-upstream commit direction
docs(readme): document post-command trust gate
```

A Husky pre-commit hook runs `lint-staged` (Prettier + ESLint on staged `.ts`
files). If the hook misbehaves in your environment, you can bypass it with
`git commit --no-verify`, but please ensure `pnpm validate` still passes.

## Branch Naming

- `main` — production / release branch
- `develop` — integration branch
- `feature/<name>` — new features
- `fix/<name>` — bug fixes

## Pull Request Expectations

- Keep PRs focused on a single concern.
- Ensure `pnpm validate` passes (and `pnpm test:e2e` when your change affects
  end-to-end behavior).
- Add or update tests for new behavior; tests mirror `src/` under `test/`.
- Update documentation alongside code:
  - User-facing behavior → `README.md`
  - Architecture changes → `ARCHITECTURE.md`
  - Module-level changes → the relevant `DESIGN.md`
  - Notable changes → `CHANGELOG.md` (under `[Unreleased]`)
- Every command should support the `--json` flag and use `ErrorHelper` for
  consistent error output.

## Where to Look

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture, layers, and
  extension points.
- [DESIGN.md](./DESIGN.md) — design rationale and trade-offs.
- `src/commands/DESIGN.md` and `src/utils/DESIGN.md` — module-level design notes.
- [README.md](./README.md) — command reference and configuration.

By contributing, you agree that your contributions will be licensed under the
project's MIT License.
