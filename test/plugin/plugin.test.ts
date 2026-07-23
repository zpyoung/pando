import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = process.cwd()
const pluginRoot = path.join(repositoryRoot, 'plugin')
const worktreeCreateScript = path.join(pluginRoot, 'scripts/worktree-create.sh')
const sessionEndScript = path.join(pluginRoot, 'scripts/session-end.sh')

function commandExists(command: string): boolean {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0
}

function resolveCommand(command: string): string {
  const result = spawnSync('bash', ['-c', 'command -v "$1"', 'bash', command], {
    encoding: 'utf8',
  })
  const resolved = result.stdout.trim()
  if (result.status !== 0 || !path.isAbsolute(resolved)) {
    throw new Error(`Could not resolve command: ${command}`)
  }
  return resolved
}

const bashTest = commandExists('bash') ? it : it.skip
const jqShellTest = commandExists('bash') && commandExists('jq') ? it : it.skip

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function makeTempDirectory(): Promise<string> {
  return mkdtemp('/tmp/pando-plugin-test-')
}

async function makeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents, 'utf8')
  await chmod(filePath, 0o755)
}

function runHook(
  script: string,
  cwd: string,
  input: Record<string, string>,
  env: NodeJS.ProcessEnv
) {
  return spawnSync('bash', [script], {
    cwd,
    env: { ...process.env, ...env },
    input: JSON.stringify(input),
    encoding: 'utf8',
  })
}

describe('Claude Code plugin manifests', () => {
  it('defines an installable marketplace and plugin manifest', async () => {
    const marketplace = await readJson(path.join(repositoryRoot, '.claude-plugin/marketplace.json'))
    const manifest = await readJson(path.join(pluginRoot, '.claude-plugin/plugin.json'))

    expect(marketplace.name).toBe('pando')
    expect(marketplace.owner.name).toBeTruthy()
    expect(marketplace.plugins).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'pando', source: './plugin' })])
    )

    expect(manifest.name).toBe('pando')
    expect(manifest).not.toHaveProperty('version')
    expect(manifest.hooks).toBe('./hooks/hooks.json')
    expect(manifest.userConfig.delegateCreation).toMatchObject({
      type: 'boolean',
      default: true,
    })
    expect(manifest.userConfig.reapOnSessionEnd).toMatchObject({
      type: 'boolean',
      default: true,
    })
  })

  it('registers WorktreeCreate and a time-bounded SessionEnd hook', async () => {
    const config = await readJson(path.join(pluginRoot, 'hooks/hooks.json'))
    const createHandler = config.hooks.WorktreeCreate[0].hooks[0]
    const endHandler = config.hooks.SessionEnd[0].hooks[0]

    expect(createHandler.command).toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(createHandler.command).toContain('/scripts/worktree-create.sh')
    expect(endHandler.command).toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(endHandler.command).toContain('/scripts/session-end.sh')
    expect(endHandler.timeout).toBeGreaterThanOrEqual(30)
    expect(config.hooks.WorktreeCreate[0]).not.toHaveProperty('matcher')
    expect(config.hooks.SessionEnd[0]).not.toHaveProperty('matcher')
  })

  it('ships executable hooks and discoverable skills and commands', async () => {
    const [createMode, endMode, skill, statusCommand, reapCommand] = await Promise.all([
      stat(worktreeCreateScript),
      stat(sessionEndScript),
      readFile(path.join(pluginRoot, 'skills/pando-worktrees/SKILL.md'), 'utf8'),
      readFile(path.join(pluginRoot, 'commands/pando-status.md'), 'utf8'),
      readFile(path.join(pluginRoot, 'commands/pando-reap.md'), 'utf8'),
    ])

    expect(createMode.mode & 0o111).not.toBe(0)
    expect(endMode.mode & 0o111).not.toBe(0)
    expect(skill).toMatch(/^---\n/)
    expect(skill).toMatch(/\nname: pando-worktrees\n/)
    expect(skill).toMatch(/\ndescription: .+\n---\n/)
    expect(statusCommand).toMatch(/^---\ndescription: .+\n---\n/)
    expect(reapCommand).toMatch(/^---\ndescription: .+\n---\n/)
  })
})

describe('plugin hook scripts', () => {
  jqShellTest('delegates worktree creation to pando and emits only its path', async () => {
    const tempRoot = await makeTempDirectory()
    try {
      const fakeBin = path.join(tempRoot, 'bin')
      const pandoLog = path.join(tempRoot, 'pando.log')
      await mkdir(fakeBin)
      await makeExecutable(
        path.join(fakeBin, 'pando'),
        `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$PANDO_LOG"
if [ "\${1:-}" = "--version" ]; then
  printf '@zyoung-ff/pando/0.1.0 test-node\\n'
  exit 0
fi
if [ "\${1:-}" = "add" ]; then
  worktree_path=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--path" ]; then
      shift
      worktree_path="$1"
    fi
    shift
  done
  mkdir -p "$worktree_path"
  printf '{"success":true,"worktree":{"path":"%s"}}\\n' "$worktree_path"
  exit 0
fi
exit 1
`
      )

      const expectedPath = path.join(await realpath(tempRoot), '.claude/worktrees/feature-auth')
      const result = runHook(
        worktreeCreateScript,
        tempRoot,
        { name: 'feature-auth', session_id: 'session-123', cwd: tempRoot },
        {
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PANDO_LOG: pandoLog,
        }
      )

      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe(expectedPath)
      const calls = await readFile(pandoLog, 'utf8')
      expect(calls).toContain('--version')
      expect(calls).toContain(
        `add feature-auth --path ${expectedPath} --ephemeral --owner session-123 --json`
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  jqShellTest('falls back to fake git after a pando error and still exits zero', async () => {
    const tempRoot = await makeTempDirectory()
    try {
      const fakeBin = path.join(tempRoot, 'bin')
      const pandoLog = path.join(tempRoot, 'pando.log')
      const gitLog = path.join(tempRoot, 'git.log')
      await mkdir(fakeBin)
      await makeExecutable(
        path.join(fakeBin, 'pando'),
        `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$PANDO_LOG"
if [ "\${1:-}" = "--version" ]; then
  printf 'pando/0.1.0 test\\n'
  exit 0
fi
exit 17
`
      )
      await makeExecutable(
        path.join(fakeBin, 'git'),
        `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$GIT_LOG"
if [ "\${1:-}" = "-C" ] && [ "\${3:-}" = "rev-parse" ]; then
  printf '%s\\n' "$FAKE_REPO_ROOT"
  exit 0
fi
if [ "\${1:-}" = "-C" ] && [ "\${3:-}" = "worktree" ] && [ "\${4:-}" = "add" ]; then
  target="\${!#}"
  mkdir -p "$target"
  exit 0
fi
exit 1
`
      )

      const targetPath = path.join(tempRoot, '.claude/worktrees/fallback-task')
      const expectedPath = path.join(await realpath(tempRoot), '.claude/worktrees/fallback-task')
      const result = runHook(
        worktreeCreateScript,
        tempRoot,
        { name: 'fallback-task', session_id: 'session-456', cwd: tempRoot },
        {
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PANDO_LOG: pandoLog,
          GIT_LOG: gitLog,
          FAKE_REPO_ROOT: tempRoot,
        }
      )

      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe(expectedPath)
      expect(await readFile(gitLog, 'utf8')).toContain(
        `worktree add -b fallback-task ${targetPath}`
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  jqShellTest('emits an existing absolute fallback path when TMPDIR is relative', async () => {
    const tempRoot = await makeTempDirectory()
    let emittedPath: string | undefined
    try {
      const fakeBin = path.join(tempRoot, 'bin')
      const blockedParent = path.join(tempRoot, 'blocked')
      const relativeTmp = path.join(tempRoot, 'reltmp')
      await mkdir(fakeBin)
      await mkdir(relativeTmp)
      await writeFile(blockedParent, 'not a directory', 'utf8')

      await Promise.all(
        ['bash', 'cat', 'dirname', 'head', 'jq', 'mkdir', 'mktemp', 'rmdir', 'sed', 'tr'].map(
          (command) => symlink(resolveCommand(command), path.join(fakeBin, command))
        )
      )
      await makeExecutable(
        path.join(fakeBin, 'git'),
        `#!/bin/sh
if [ "\${1:-}" = "-C" ] && [ "\${3:-}" = "rev-parse" ]; then
  printf '%s\\n' "$FAKE_REPO_ROOT"
  exit 0
fi
exit 1
`
      )

      const result = runHook(
        worktreeCreateScript,
        tempRoot,
        { name: 'relative-tmp', session_id: 'session-relative-tmp', cwd: tempRoot },
        {
          PATH: fakeBin,
          TMPDIR: 'reltmp',
          FAKE_REPO_ROOT: path.join(blockedParent, 'repo'),
        }
      )

      expect(result.status).toBe(0)
      const stdoutLines = result.stdout.split(/\r?\n/).filter(Boolean)
      expect(stdoutLines).toHaveLength(1)
      emittedPath = stdoutLines[stdoutLines.length - 1]
      expect(emittedPath.startsWith('/')).toBe(true)
      expect((await stat(emittedPath)).isDirectory()).toBe(true)
    } finally {
      if (emittedPath && /^pando-(relative-tmp|worktree)\./.test(path.basename(emittedPath))) {
        await rm(emittedPath, { recursive: true, force: true })
      }
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  jqShellTest('unlocks owned worktrees and runs owner-scoped session reaping', async () => {
    const tempRoot = await makeTempDirectory()
    try {
      const fakeBin = path.join(tempRoot, 'bin')
      const pandoLog = path.join(tempRoot, 'pando.log')
      await mkdir(fakeBin)
      await makeExecutable(
        path.join(fakeBin, 'pando'),
        `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$PANDO_LOG"
case "\${1:-}" in
  --version)
    printf 'pando/0.1.0 test\\n'
    ;;
  list)
    printf '%s\\n' '{"worktrees":[{"path":"/tmp/owned-worktree","owner":"session-789","locked":true},{"path":"/tmp/other-worktree","owner":"other","locked":true}]}'
    ;;
  unlock|reap)
    printf '%s\\n' '{"success":true}'
    ;;
  *)
    exit 1
    ;;
esac
`
      )

      const result = runHook(
        sessionEndScript,
        tempRoot,
        { session_id: 'session-789', cwd: tempRoot, reason: 'other' },
        {
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PANDO_LOG: pandoLog,
        }
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      const calls = await readFile(pandoLog, 'utf8')
      expect(calls).toContain('list --json')
      expect(calls).toContain('unlock /tmp/owned-worktree --json')
      expect(calls).not.toContain('unlock /tmp/other-worktree --json')
      expect(calls).toContain('reap --owner session-789 --force --json')
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  bashTest('does no session cleanup when reapOnSessionEnd is false', async () => {
    const tempRoot = await makeTempDirectory()
    try {
      const fakeBin = path.join(tempRoot, 'bin')
      const pandoLog = path.join(tempRoot, 'pando.log')
      await mkdir(fakeBin)
      await makeExecutable(
        path.join(fakeBin, 'pando'),
        `#!/usr/bin/env bash
printf 'called\\n' >> "$PANDO_LOG"
exit 99
`
      )

      const result = runHook(
        sessionEndScript,
        tempRoot,
        { session_id: 'session-disabled', cwd: tempRoot, reason: 'other' },
        {
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PANDO_LOG: pandoLog,
          CLAUDE_PLUGIN_OPTION_REAPONSESSIONEND: 'false',
        }
      )

      expect(result.status).toBe(0)
      await expect(readFile(pandoLog, 'utf8')).rejects.toThrow()
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
