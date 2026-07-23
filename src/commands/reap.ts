import { Command, Flags } from '@oclif/core'
import { confirm } from '@inquirer/prompts'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { loadConfig } from '../config/loader.js'
import type { PandoConfig } from '../config/schema.js'
import { forceFlag, jsonFlag } from '../utils/common-flags.js'
import { ErrorHelper, isOclifExitError } from '../utils/errors.js'
import { createGitHelper, type GitHelper } from '../utils/git.js'
import { enumerateAll, type WorktreeMetadata } from '../utils/worktreeMetadata.js'

export interface ReapSelectionWorktree {
  worktreePath: string
  metadata: WorktreeMetadata
  branch?: string | null
  isLocked?: boolean
  /** Supplying age directly lets callers retain GitHelper's metadata/mtime fallback. */
  ageMs?: number
}

export interface ReapCandidate {
  path: string
  branch: string | null
  kind: 'ephemeral'
  ageMs: number
}

export interface ReapSkipped {
  path: string
  reason: string
}

interface ReapError {
  path: string
  error: string
}

interface ReapResult {
  status: 'success' | 'error' | 'nothing_to_reap' | 'cancelled'
  dryRun: boolean
  reapable: ReapCandidate[]
  reaped: ReapCandidate[]
  skipped: ReapSkipped[]
  errors: ReapError[]
  warnings: string[]
}

export interface ReapSelectionOptions {
  now: number
  config: { worktree: Pick<PandoConfig['worktree'], 'ephemeralTtl'> }
  owner?: string
}

interface ReapCleanOptions {
  targetBranch: string
  requireMerged: boolean
}

interface ReapCleanDependencies {
  hasUncommittedChanges(path: string): Promise<boolean>
  isReapClean(path: string, targetBranch: string): Promise<boolean>
}

/** Parse a deliberately small, predictable TTL syntax into milliseconds. */
export function parseTtl(ttl: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([smhd])?$/i.exec(ttl.trim())
  if (!match) return null

  const amountText = match[1]
  if (amountText === undefined) return null

  const amount = Number(amountText)
  const suffix = match[2]?.toLowerCase()
  const multiplier =
    suffix === 's'
      ? 1000
      : suffix === 'm'
        ? 60_000
        : suffix === 'h'
          ? 3_600_000
          : suffix === 'd'
            ? 86_400_000
            : 1
  const milliseconds = amount * multiplier

  return Number.isFinite(milliseconds) ? milliseconds : null
}

/**
 * Select only lifecycle-expired worktrees. Safety-related exclusions are kept
 * out of the result so callers cannot accidentally reinterpret them as skipped
 * cleanup work.
 */
export function selectReapable(
  worktrees: ReapSelectionWorktree[],
  options: ReapSelectionOptions
): ReapCandidate[] {
  const selected: ReapCandidate[] = []

  for (const worktree of worktrees) {
    const { metadata } = worktree
    if (metadata.kind !== 'ephemeral' || worktree.isLocked) continue
    if (options.owner !== undefined && metadata.owner !== options.owner) continue

    const effectiveTtl = metadata.ttl ?? options.config.worktree.ephemeralTtl
    if (effectiveTtl === undefined) continue
    const ttlMs = parseTtl(effectiveTtl)
    if (ttlMs === null) continue

    let ageMs = worktree.ageMs
    if (ageMs === undefined && metadata.createdAt !== undefined) {
      const createdAtMs = Date.parse(metadata.createdAt)
      if (Number.isFinite(createdAtMs)) ageMs = Math.max(0, options.now - createdAtMs)
    }

    // Unknown age is treated as new rather than risking premature removal.
    if (ageMs === undefined || !Number.isFinite(ageMs) || ageMs <= ttlMs) continue

    selected.push({
      path: worktree.worktreePath,
      branch: worktree.branch ?? null,
      kind: 'ephemeral',
      ageMs,
    })
  }

  return selected
}

/** Partition expired candidates without weakening the dirty-worktree invariant. */
export async function partitionReapClean(
  candidates: ReapCandidate[],
  options: ReapCleanOptions,
  dependencies: ReapCleanDependencies
): Promise<{ clean: ReapCandidate[]; skipped: ReapSkipped[] }> {
  const clean: ReapCandidate[] = []
  const skipped: ReapSkipped[] = []

  for (const candidate of candidates) {
    try {
      if (await dependencies.hasUncommittedChanges(candidate.path)) {
        skipped.push({ path: candidate.path, reason: 'dirty: has uncommitted changes' })
        continue
      }

      if (options.requireMerged) {
        const isCleanAndMerged = await dependencies.isReapClean(
          candidate.path,
          options.targetBranch
        )
        if (!isCleanAndMerged) {
          skipped.push({
            path: candidate.path,
            reason: `unmerged into '${options.targetBranch}' or cleanliness could not be verified`,
          })
          continue
        }
      }

      clean.push(candidate)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      skipped.push({ path: candidate.path, reason: `cleanliness check failed: ${message}` })
    }
  }

  return { clean, skipped }
}

export default class ReapWorktree extends Command {
  static description = 'Reclaim expired ephemeral worktrees that are safe to remove'

  static examples = [
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --owner session-123',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    'dry-run': Flags.boolean({
      description: 'Show what would be reaped without acting',
      default: false,
    }),
    owner: Flags.string({
      description: 'Only reap worktrees owned by this session',
    }),
    force: forceFlag,
    json: jsonFlag,
  }

  private emptyResult(dryRun: boolean): ReapResult {
    return {
      status: 'success',
      dryRun,
      reapable: [],
      reaped: [],
      skipped: [],
      errors: [],
      warnings: [],
    }
  }

  private async outputResult(result: ReapResult, isJson: boolean): Promise<void> {
    const hasError = result.status === 'error' || result.errors.length > 0

    if (isJson) {
      this.log(JSON.stringify(result, null, 2))
      if (hasError) this.exit(1)
      return
    }

    const chalk = (await import('chalk')).default

    if (result.dryRun && result.reapable.length > 0) {
      this.log(chalk.yellow('\nWorktrees that would be reaped:'))
      for (const candidate of result.reapable) {
        this.log(`  ${chalk.cyan(candidate.path)} (${candidate.branch ?? 'detached'})`)
      }
    } else if (result.reaped.length > 0) {
      this.log(
        chalk.green(
          `\n✓ Reaped ${result.reaped.length} worktree${result.reaped.length === 1 ? '' : 's'}:`
        )
      )
      for (const candidate of result.reaped) {
        this.log(`  ${chalk.cyan(candidate.path)} (${candidate.branch ?? 'detached'})`)
      }
    }

    if (result.skipped.length > 0) {
      this.log(chalk.yellow('\n⚠ Expired worktrees skipped for safety:'))
      for (const skipped of result.skipped) {
        this.log(`  ${chalk.cyan(skipped.path)}: ${skipped.reason}`)
      }
    }

    for (const warning of result.warnings) this.warn(warning)

    if (result.status === 'nothing_to_reap') {
      this.log(chalk.green('No expired ephemeral worktrees are eligible for reaping.'))
    } else if (result.status === 'cancelled') {
      this.log(chalk.yellow('Reaping cancelled.'))
    }

    if (result.errors.length > 0) {
      this.log(chalk.red('\n✗ Some worktrees could not be reaped:'))
      for (const error of result.errors) {
        this.log(`  ${chalk.cyan(error.path)}: ${chalk.yellow(error.error)}`)
      }
    }

    if (hasError) this.exit(1)
  }

  private async reapCandidates(
    gitHelper: GitHelper,
    candidates: ReapCandidate[],
    result: ReapResult
  ): Promise<void> {
    for (const candidate of candidates) {
      const currentWorktrees = await gitHelper.listWorktrees()
      const currentWorktree = currentWorktrees.find(
        (worktree) => path.resolve(worktree.path) === path.resolve(candidate.path)
      )
      if (currentWorktree?.isLocked) {
        result.skipped.push({ path: candidate.path, reason: 'locked after selection' })
        continue
      }

      try {
        // Never pass force: Git's own dirty-tree guard protects against races
        // between selection and removal.
        await gitHelper.removeWorktree(candidate.path)
        result.reaped.push(candidate)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result.errors.push({ path: candidate.path, error: message })
        result.skipped.push({ path: candidate.path, reason: `removal failed: ${message}` })
        continue
      }

      if (candidate.branch) {
        try {
          if (await gitHelper.branchExists(candidate.branch)) {
            // A normal delete preserves commits if repository state changed
            // after the cleanliness check.
            await gitHelper.deleteBranch(candidate.branch)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          result.warnings.push(
            `Reaped ${candidate.path}, but kept branch '${candidate.branch}': ${message}`
          )
        }
      }
    }

    if (result.errors.length > 0 && result.reaped.length === 0) result.status = 'error'
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ReapWorktree)
    const result = this.emptyResult(flags['dry-run'] ?? false)

    try {
      const gitHelper = createGitHelper()
      if (!(await gitHelper.isRepository())) {
        ErrorHelper.validation(this, 'Not a git repository', flags.json)
      }

      const gitRoot = await gitHelper.getRepositoryRoot()
      const mainWorktreePath = await gitHelper.getMainWorktreePath()
      const config = await loadConfig({ gitRoot })
      gitHelper.setRetryConfig(config.concurrency.retry)
      const [metadataEntries, listedWorktrees] = await Promise.all([
        enumerateAll(mainWorktreePath),
        gitHelper.listWorktrees(),
      ])
      const listedByPath = new Map(
        listedWorktrees.map((worktree) => [path.resolve(worktree.path), worktree])
      )
      const now = Date.now()
      const snapshots: ReapSelectionWorktree[] = []

      for (const entry of metadataEntries) {
        if (path.resolve(entry.worktreePath) === path.resolve(mainWorktreePath)) continue

        const listed = listedByPath.get(path.resolve(entry.worktreePath))
        let ageMs: number
        try {
          ageMs = await gitHelper.getWorktreeAgeMs(entry.worktreePath)
        } catch {
          // An unknown age must never make a worktree eligible.
          ageMs = 0
        }

        snapshots.push({
          worktreePath: entry.worktreePath,
          metadata: entry.metadata,
          branch: listed?.branch ?? null,
          // A metadata/listing mismatch is repository uncertainty, not proof
          // that a worktree is unlocked.
          isLocked: listed === undefined ? true : (listed.isLocked ?? false),
          ageMs,
        })
      }

      const candidates = selectReapable(snapshots, {
        now,
        config,
        ...(flags.owner !== undefined ? { owner: flags.owner } : {}),
      })
      const partition = await partitionReapClean(
        candidates,
        {
          targetBranch: config.worktree.targetBranch ?? 'main',
          requireMerged: config.reap.requireMerged,
        },
        {
          // GitHelper's general-purpose status check is intentionally lenient
          // on status errors; reaping instead needs an observable failure so
          // partitionReapClean can fail closed.
          hasUncommittedChanges: async (worktreePath) => {
            const status = await simpleGit(worktreePath).status()
            return !status.isClean()
          },
          isReapClean: (worktreePath, targetBranch) =>
            gitHelper.isReapClean(worktreePath, targetBranch),
        }
      )
      result.reapable = partition.clean
      result.skipped.push(...partition.skipped)

      if (candidates.length === 0) {
        result.status = 'nothing_to_reap'
        await this.outputResult(result, flags.json ?? false)
        return
      }

      if (flags['dry-run']) {
        await this.outputResult(result, flags.json ?? false)
        return
      }

      if (partition.clean.length === 0) {
        await this.outputResult(result, flags.json ?? false)
        return
      }

      if (!flags.force && !flags.json) {
        if (!process.stdin.isTTY) {
          result.status = 'cancelled'
          result.warnings.push('Non-interactive reaping requires --force (or --json).')
          await this.outputResult(result, false)
          return
        }

        const confirmed = await confirm({
          message: `Reap ${partition.clean.length} expired worktree${partition.clean.length === 1 ? '' : 's'}?`,
          default: false,
        })
        if (!confirmed) {
          result.status = 'cancelled'
          await this.outputResult(result, false)
          return
        }
      }

      await this.reapCandidates(gitHelper, partition.clean, result)
      await this.outputResult(result, flags.json ?? false)
    } catch (error) {
      if (isOclifExitError(error)) throw error
      ErrorHelper.operation(
        this,
        error instanceof Error ? error : new Error(String(error)),
        'Failed to reap worktrees',
        flags.json
      )
    }
  }
}
