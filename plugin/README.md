# pando plugin for Claude Code

This plugin delegates Claude Code worktree creation and lifecycle cleanup to the `pando` CLI. It also provides the `pando-worktrees` skill and the `/pando:pando-status` and `/pando:pando-reap` commands.

## Requirements

Install these before installing the plugin:

- Git 2.38 or newer (pando uses worktree-specific Git configuration).
- A recent Claude Code release with plugin `userConfig`, `WorktreeCreate`, and `SessionEnd` support.
- The `pando` CLI.
- `jq` is recommended for structured hook input/output parsing. Without it, worktree creation degrades to plain Git and session cleanup is limited to best-effort reaping.

Install the CLI from npm:

```sh
pnpm add -g @zyoung-ff/pando
```

Or install a downloaded release/package tarball:

```sh
pnpm add -g ./zyoung-ff-pando-<version>.tgz
```

Verify both dependencies:

```sh
pando --version
git --version
```

## Install the plugin

In Claude Code, add this repository as a marketplace and install its plugin:

```text
/plugin marketplace add zpyoung/pando
/plugin install pando@pando
```

Restart Claude Code if the newly installed hooks are not active in the current session.

The hooks check `pando --version` at runtime. Worktree creation falls back to `git worktree add` when the CLI is missing, too old, disabled, or returns an unusable response, so Claude Code can still create its isolated worktree.

## Configuration

Claude Code prompts for these options when enabling the plugin. Both default to `true`:

- `delegateCreation`: let pando create Claude Code worktrees and attach ephemeral lifecycle metadata. Set it to `false` to use plain `git worktree add`.
- `reapOnSessionEnd`: unlock worktrees owned by an ending session and run owner-scoped pando reaping. Set it to `false` to disable session-end cleanup.

They can also be supplied during CLI installation, for example:

```sh
claude plugin install pando@pando --config delegateCreation=true --config reapOnSessionEnd=true
```

## Usage

Claude Code automatically uses pando when it creates an isolated worktree. The bundled skill guides ephemeral versus long-lived worktree choices and locking behavior.

Use `/pando:pando-status` to summarize `pando list --json` and `pando health --json`. Use `/pando:pando-reap` to preview expired worktrees and confirm cleanup before running it.

Pando post-commands remain subject to pando's normal configuration trust gate. The plugin does not set `PANDO_TRUST_CONFIG`; trust project configuration separately when appropriate.
