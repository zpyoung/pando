import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'

export interface WorktreeMetadata {
  kind?: 'ephemeral' | 'long-lived'
  createdAt?: string
  sourceBranch?: string
  owner?: string
  ttl?: string
  ports?: Record<string, number>
  dbName?: string
}

const PANDO_KEY_PATTERN = '^pando\\.'
const MIGRATED_CORE_KEYS = ['core.worktree', 'core.bare', 'core.sparseCheckout'] as const
// git lowercases config keys on read; this mirrors the allocator's write-time
// name guard (git-config-valid: leading letter, then letters/digits/hyphen).
const VALID_PORT_NAME = /^[a-z][a-z0-9-]*$/

function parseMetadata(output: string): WorktreeMetadata {
  const metadata: WorktreeMetadata = {}

  for (const record of output.split('\0')) {
    if (!record) continue

    const separatorIndex = record.indexOf('\n')
    if (separatorIndex === -1) continue

    const rawKey = record.slice(0, separatorIndex)
    if (!rawKey) continue

    const key = rawKey.toLowerCase()
    const value = record.slice(separatorIndex + 1)

    switch (key) {
      case 'pando.kind': {
        if (value === 'ephemeral' || value === 'long-lived') metadata.kind = value
        break
      }
      case 'pando.createdat': {
        metadata.createdAt = value
        break
      }
      case 'pando.sourcebranch': {
        metadata.sourceBranch = value
        break
      }
      case 'pando.owner': {
        metadata.owner = value
        break
      }
      case 'pando.ttl': {
        metadata.ttl = value
        break
      }
      case 'pando.db.name': {
        metadata.dbName = value
        break
      }
      default: {
        if (key.startsWith('pando.port.')) {
          const name = key.slice('pando.port.'.length)
          const port = Number(value)
          // Only accept git-config-valid names (matches the allocator's write
          // guard) and use a null-prototype map so a key like `__proto__` or
          // `constructor` cannot pollute the prototype of the ports object.
          if (VALID_PORT_NAME.test(name) && value.trim() && Number.isFinite(port)) {
            metadata.ports ??= Object.create(null) as Record<string, number>
            metadata.ports[name] = port
          }
        }
      }
    }
  }

  return metadata
}

async function readMetadataFile(git: SimpleGit, configPath: string): Promise<WorktreeMetadata> {
  try {
    const output = await git.raw([
      'config',
      '--file',
      configPath,
      '--get-regexp',
      '--null',
      PANDO_KEY_PATTERN,
    ])
    return parseMetadata(output)
  } catch {
    // A worktree without metadata normally has no config.worktree file or matching keys.
    return {}
  }
}

export async function readMetadata(worktreePath: string): Promise<WorktreeMetadata> {
  try {
    const output = await simpleGit(worktreePath).raw([
      'config',
      '--worktree',
      '--get-regexp',
      '--null',
      PANDO_KEY_PATTERN,
    ])
    return parseMetadata(output)
  } catch {
    // Metadata must remain optional for repositories not yet using worktree config.
    return {}
  }
}

export async function unsetPort(worktreePath: string, name: string): Promise<void> {
  try {
    await simpleGit(worktreePath).raw(['config', '--worktree', '--unset', `pando.port.${name}`])
  } catch {
    // An absent port key is already in the desired state.
  }
}

export async function writeMetadata(
  worktreePath: string,
  patch: Partial<WorktreeMetadata>
): Promise<void> {
  const git = simpleGit(worktreePath)
  const values: Array<[key: string, value: string]> = []

  if (patch.kind !== undefined) values.push(['pando.kind', patch.kind])
  if (patch.createdAt !== undefined) values.push(['pando.createdAt', patch.createdAt])
  if (patch.sourceBranch !== undefined) values.push(['pando.sourceBranch', patch.sourceBranch])
  if (patch.owner !== undefined) values.push(['pando.owner', patch.owner])
  if (patch.ttl !== undefined) values.push(['pando.ttl', patch.ttl])
  if (patch.dbName !== undefined) values.push(['pando.db.name', patch.dbName])
  if (patch.ports !== undefined) {
    for (const [name, port] of Object.entries(patch.ports)) {
      values.push([`pando.port.${name}`, String(port)])
    }
  }

  for (const [key, value] of values) {
    await git.raw(['config', '--worktree', key, value])
  }
}

function parseWorktreePaths(output: string): string[] {
  return output
    .split('\0')
    .filter((attribute) => attribute.startsWith('worktree '))
    .map((attribute) => attribute.slice('worktree '.length))
}

async function linkedConfigPath(
  worktreePath: string,
  gitCommonDir: string
): Promise<string | undefined> {
  try {
    const dotGit = await readFile(path.join(worktreePath, '.git'), 'utf8')
    const gitDirValue = /^gitdir:\s*(.+?)\s*$/im.exec(dotGit)?.[1]
    if (!gitDirValue) return undefined

    // The id is authoritative in the linked worktree's .git pointer; using the
    // common dir avoids accidentally asking Git to read the current worktree.
    const gitDir = path.resolve(worktreePath, gitDirValue)
    const id = path.basename(gitDir)
    return path.join(gitCommonDir, 'worktrees', id, 'config.worktree')
  } catch {
    return undefined
  }
}

export async function enumerateAll(
  mainRepoPath: string
): Promise<Array<{ worktreePath: string; metadata: WorktreeMetadata }>> {
  const git = simpleGit(mainRepoPath)
  const worktreeOutput = await git.raw(['worktree', 'list', '--porcelain', '-z'])
  const worktreePaths = parseWorktreePaths(worktreeOutput)
  const commonDirOutput = await git.raw(['rev-parse', '--git-common-dir'])
  const gitCommonDir = path.resolve(mainRepoPath, commonDirOutput.trim())
  const entries: Array<{ worktreePath: string; metadata: WorktreeMetadata }> = []

  for (const [index, worktreePath] of worktreePaths.entries()) {
    // Git's porcelain format guarantees that the main worktree is listed first.
    const configPath =
      index === 0
        ? path.join(gitCommonDir, 'config.worktree')
        : await linkedConfigPath(worktreePath, gitCommonDir)
    const metadata = configPath ? await readMetadataFile(git, configPath) : {}
    entries.push({ worktreePath, metadata })
  }

  return entries
}

export async function ensureWorktreeConfigEnabled(
  repoPath: string
): Promise<{ enabled: boolean; migrated: string[]; notice?: string }> {
  const git = simpleGit(repoPath)

  try {
    const current = await git.raw(['config', '--get', 'extensions.worktreeConfig'])
    if (current.trim().toLowerCase() === 'true') return { enabled: true, migrated: [] }
  } catch {
    // An absent setting is the expected state before first-time enablement.
  }

  const settings: Array<{ name: string; value: string }> = []
  for (const name of MIGRATED_CORE_KEYS) {
    try {
      const value = await git.raw(['config', '--local', '--get', name])
      settings.push({ name, value: value.trim() })
    } catch {
      // Missing core settings need no per-worktree override.
    }
  }

  await git.raw(['config', 'extensions.worktreeConfig', 'true'])
  for (const { name, value } of settings) {
    await git.raw(['config', '--worktree', name, value])
    await git.raw(['config', '--local', '--unset', name])
  }

  const migrated = settings.map(({ name }) => name)
  const summary = migrated.length > 0 ? migrated.join(', ') : 'none'
  return {
    enabled: true,
    migrated,
    notice: `Enabled extensions.worktreeConfig (migrated: ${summary})`,
  }
}

export async function assertGitVersion(minMajor = 2, minMinor = 38): Promise<void> {
  let output: string
  try {
    output = await simpleGit().raw(['--version'])
  } catch {
    return
  }

  const match = /git version\s+(\d+)\.(\d+)(?:\.(\d+))?/i.exec(output)
  const majorText = match?.[1]
  const minorText = match?.[2]
  if (!majorText || !minorText) return

  const major = Number(majorText)
  const minor = Number(minorText)
  if (major < minMajor || (major === minMajor && minor < minMinor)) {
    const found = [majorText, minorText, match?.[3]].filter(Boolean).join('.')
    throw new Error(
      `pando worktree metadata requires git >= ${minMajor}.${minMinor} (found ${found})`
    )
  }
}
