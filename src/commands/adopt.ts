import { Args, Command, Flags } from '@oclif/core'
import { createGitHelper } from '../utils/git.js'
import { loadConfig, type LoadedPandoConfig } from '../config/loader.js'
import { readMetadata, type WorktreeMetadata } from '../utils/worktreeMetadata.js'
import {
  createWorktreeSetupOrchestrator,
  SetupPhase,
  type SetupResult,
} from '../utils/worktreeSetup.js'
import { setupLifecycleMetadata, type AddLifecycleResult } from './add.js'
import { applySetupFlagOverrides } from '../utils/setupFlags.js'
import { jsonFlag } from '../utils/common-flags.js'
import { ErrorHelper, isOclifExitError } from '../utils/errors.js'
import { runTrustedPostCommands } from '../utils/postCommandRunner.js'
import { PostCommandError, type PostCommandResult } from '../utils/postCommands.js'
import type { WorktreeInfo } from '../utils/git.js'

type WorktreeKind = NonNullable<WorktreeMetadata['kind']>

/**
 * Resolve the lifecycle kind for an adopted worktree. Unlike `pando add`, adopt
 * defaults to long-lived (a hand-created worktree with real work should not be
 * auto-reaped) and ignores `config.worktree.defaultKind` entirely; only an
 * explicit flag overrides the default.
 */
export function resolveAdoptKind(flags: Record<string, unknown>): WorktreeKind {
  if (flags.ephemeral) return 'ephemeral'
  if (flags['long-lived']) return 'long-lived'
  return 'long-lived'
}

/**
 * Adopt a git worktree pando did not create.
 *
 * Runs pando's standard setup (rsync of untracked artifacts, symlinks,
 * skip-worktree, lifecycle metadata, ports, post-commands) against a worktree
 * created by raw `git worktree add` or another tool. Never overwrites the user's
 * work and never removes the worktree.
 */
export default class AdoptWorktree extends Command {
  static description =
    'Adopt an existing git worktree (created outside pando) and run pando setup on it'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> ../feature-x',
    '<%= config.bin %> <%= command.id %> ../feature-x --dry-run',
    '<%= config.bin %> <%= command.id %> ../feature-x --replace-existing',
    '<%= config.bin %> <%= command.id %> ../feature-x --ephemeral --ttl 4h',
  ]

  static args = {
    path: Args.string({
      description: 'Path to the worktree to adopt (defaults to the current directory)',
      required: false,
    }),
  }

  static flags = {
    'dry-run': Flags.boolean({
      description: 'Preview the plan without changing anything',
      default: false,
    }),
    'replace-existing': Flags.boolean({
      description: 'Replace real files at symlink targets instead of skipping them',
      default: false,
    }),

    // Lifecycle
    ephemeral: Flags.boolean({
      description: 'Mark the worktree as ephemeral',
      exclusive: ['long-lived'],
      default: false,
    }),
    'long-lived': Flags.boolean({
      description: 'Mark the worktree as long-lived (the adopt default)',
      exclusive: ['ephemeral'],
      default: false,
    }),
    ttl: Flags.string({ description: 'Set a per-worktree lifecycle duration' }),
    owner: Flags.string({ description: 'Set the worktree owner or agent session id' }),
    ports: Flags.boolean({ description: 'Enable port allocation for this run', default: false }),

    // Rsync
    'skip-rsync': Flags.boolean({ description: 'Skip rsync (ignore config)', default: false }),
    'rsync-flags': Flags.string({
      description: 'Override rsync flags (comma-separated)',
      multiple: true,
    }),
    'rsync-exclude': Flags.string({
      description: 'Additional rsync exclude patterns',
      multiple: true,
    }),

    // Symlink
    'skip-symlink': Flags.boolean({
      description: 'Skip symlink creation (ignore config)',
      default: false,
    }),
    symlink: Flags.string({
      description: 'Additional symlink patterns (overrides config)',
      multiple: true,
    }),
    'absolute-symlinks': Flags.boolean({
      description: 'Use absolute paths for symlinks instead of relative',
      default: false,
    }),

    // Output
    details: Flags.boolean({ description: 'Show detailed setup information', default: false }),
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags, args } = await this.parse(AdoptWorktree)
    const isJson = Boolean(flags.json)
    const warnings: string[] = []
    const startTime = Date.now()
    const { spinner, chalk } = await this.initializeUI(isJson)

    try {
      const gitHelper = createGitHelper()
      if (!(await gitHelper.isRepository())) {
        this.failValidation(
          'Not a git repository. Run this command from within a git repository.',
          isJson,
          warnings
        )
      }

      const gitRoot = await gitHelper.getRepositoryRoot()

      // Resolve the target: positional arg, else the current working directory.
      const targetInput = args.path ?? process.cwd()
      const match = await gitHelper.getWorktreeByPath(targetInput)
      if (!match) {
        this.failValidation(
          `'${targetInput}' is not a linked worktree of this repository.\n\n` +
            `Use 'pando add' to create a new worktree, or run adopt from inside an existing linked worktree.`,
          isJson,
          warnings
        )
      }
      if (match.isMain) {
        this.failValidation(
          `Cannot adopt the main worktree (${match.info.path}).\n\n` +
            `Adopt applies to linked worktrees created outside pando.`,
          isJson,
          warnings
        )
      }
      // Use the canonical path git records, not the (possibly relative) input.
      const targetPath = match.info.path

      const config = await this.loadAndMergeConfig(
        flags as Record<string, unknown>,
        gitHelper,
        spinner,
        warnings
      )
      gitHelper.setRetryConfig(config.concurrency.retry)

      // Idempotent re-apply: already-managed worktrees are re-set-up, not rejected.
      const existing = await readMetadata(targetPath)
      const alreadyManaged = existing.kind !== undefined
      if (alreadyManaged && !isJson) {
        ErrorHelper.warn(
          this,
          `Worktree is already pando-managed (${existing.kind}); re-applying setup.`,
          false
        )
      }

      // Baseline dirt (best-effort): the user's pre-existing work, protected from
      // the clean-tree check and reported as preserved.
      let preexistingDirtyPaths: string[] = []
      try {
        preexistingDirtyPaths = await gitHelper.getDirtyPaths(targetPath)
      } catch {
        // Non-fatal: without a baseline the clean-tree check is just less precise.
      }

      // Idempotent re-apply must not silently rewrite lifecycle facts. When the
      // worktree is already managed and no lifecycle flag is passed, preserve its
      // existing kind / sourceBranch / createdAt (which drive reap + age); only an
      // explicit --ephemeral/--long-lived overrides the kind.
      const explicitKind = Boolean(flags.ephemeral || flags['long-lived'])
      const adoptKind: WorktreeKind = explicitKind
        ? resolveAdoptKind(flags as Record<string, unknown>)
        : (existing.kind ?? 'long-lived')
      const adoptSourceBranch = existing.sourceBranch ?? config.worktree.targetBranch ?? 'main'

      const setupResult = await this.runSetup(
        flags as Record<string, unknown>,
        config,
        gitHelper,
        targetPath,
        spinner,
        preexistingDirtyPaths
      )

      // Dry run stops here: no metadata, no ports, no post-commands.
      if (flags['dry-run']) {
        this.formatDryRun(
          flags as Record<string, unknown>,
          targetPath,
          match.info,
          setupResult,
          adoptKind,
          adoptSourceBranch,
          chalk,
          warnings
        )
        return
      }

      const mainRepoPath = config.ports.enabled
        ? await gitHelper.getMainWorktreePath().catch(() => gitRoot)
        : gitRoot
      const lifecycle = await setupLifecycleMetadata({
        flags: flags as Record<string, unknown>,
        worktreeConfig: config.worktree,
        portsConfig: config.ports,
        gitHelper,
        gitRoot,
        mainRepoPath,
        resolvedPath: targetPath,
        // First adopt records the integration branch (adopt has no "branched-from"
        // moment); a re-adopt preserves whatever was already stored.
        sourceBranch: adoptSourceBranch,
        worktreeBranch: match.info.branch,
        kindOverride: adoptKind,
        // Preserve the original creation time on re-adopt (undefined -> now on
        // first adopt).
        createdAt: existing.createdAt,
      })
      if (!isJson) {
        if (lifecycle.notice) ErrorHelper.warn(this, lifecycle.notice, false)
        lifecycle.warnings.forEach((warning) => ErrorHelper.warn(this, warning, false))
      }

      const postCommandResults = await runTrustedPostCommands({
        command: this,
        config,
        commandName: 'adopt',
        scriptKey: 'adopt',
        fallbackScriptKey: 'add',
        context: {
          cwd: targetPath,
          worktreePath: targetPath,
          branch: match.info.branch,
          commit: match.info.commit,
          kind: lifecycle.kind,
          ttl: lifecycle.effectiveTtl,
          ...(lifecycle.ports ? { ports: lifecycle.ports } : {}),
          ...(lifecycle.dbName ? { dbName: lifecycle.dbName } : {}),
        },
        isJson,
        spinner,
        warnings,
      })

      this.formatOutput({
        flags: flags as Record<string, unknown>,
        targetPath,
        info: match.info,
        setupResult,
        lifecycle,
        postCommandResults,
        alreadyManaged,
        preexistingDirtyPaths,
        duration: Date.now() - startTime,
        chalk,
        warnings,
      })
    } catch (error) {
      this.handleError(error, flags as Record<string, unknown>, spinner, warnings)
    }
  }

  private async initializeUI(isJson: boolean): Promise<{
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
    chalk: Awaited<typeof import('chalk').default> | null
  }> {
    const ora = !isJson ? (await import('ora')).default : null
    const spinner = ora ? ora() : null
    const chalk = !isJson ? (await import('chalk')).default : null
    return { spinner, chalk }
  }

  private emitWarning(message: string, isJson: boolean, warnings: string[]): void {
    if (isJson) {
      warnings.push(message)
    } else {
      ErrorHelper.warn(this, message, false)
    }
  }

  private failValidation(message: string, isJson: boolean, warnings: string[]): never {
    if (!isJson) return ErrorHelper.validation(this, message, false)
    this.log(JSON.stringify({ success: false, error: message, warnings }, null, 2))
    this.exit(1)
  }

  private async loadAndMergeConfig(
    flags: Record<string, unknown>,
    gitHelper: ReturnType<typeof createGitHelper>,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    warnings: string[]
  ): Promise<LoadedPandoConfig> {
    if (spinner) spinner.text = 'Loading configuration...'
    // adopt runs from inside the target worktree, so process.cwd()/--show-toplevel
    // both resolve to that worktree. Project config (symlink/rsync patterns) lives
    // in the main worktree — which is also the rsync/symlink source. Loading from
    // the target worktree instead would miss the real config AND try to parse the
    // user's own local files (e.g. a non-JSON package.json at a symlink target),
    // which adopt must tolerate rather than choke on.
    const mainWorktree = await gitHelper.getMainWorktreePath()
    const config = await loadConfig({ cwd: mainWorktree, gitRoot: mainWorktree })
    applySetupFlagOverrides(config, flags, (message) =>
      this.emitWarning(message, Boolean(flags.json), warnings)
    )
    return config
  }

  private async runSetup(
    flags: Record<string, unknown>,
    config: LoadedPandoConfig,
    gitHelper: ReturnType<typeof createGitHelper>,
    targetPath: string,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    preexistingDirtyPaths: string[]
  ): Promise<SetupResult> {
    const orchestrator = createWorktreeSetupOrchestrator(gitHelper, config)
    const setupOptions = {
      adopt: true,
      dryRun: flags['dry-run'] as boolean | undefined,
      replaceExistingSymlinks: flags['replace-existing'] as boolean | undefined,
      skipRsync: flags['skip-rsync'] as boolean | undefined,
      skipSymlink: flags['skip-symlink'] as boolean | undefined,
      preexistingDirtyPaths,
      onProgress: this.buildProgressCallback(spinner),
    }

    // A SIGINT mid-setup triggers the orchestrator's rollback. In adopt mode
    // rollback is non-destructive (it never removes the worktree), so this is
    // safe even though the worktree predates pando.
    const sigintListener = (): void => {
      void (async (): Promise<void> => {
        if (spinner) spinner.stop()
        try {
          await orchestrator.rollback()
        } catch {
          // rollback swallows its own errors; this guard just ensures exit 130.
        }
        if (!flags.json) this.log('\nInterrupted — rolled back pando changes (worktree preserved)')
        process.exit(130)
      })()
    }
    process.once('SIGINT', sigintListener)

    try {
      return await orchestrator.setupNewWorktree(targetPath, setupOptions)
    } catch (error) {
      if (spinner) spinner.fail('Setup failed')
      throw error
    } finally {
      process.removeListener('SIGINT', sigintListener)
    }
  }

  private buildProgressCallback(
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
  ): (phase: SetupPhase, message: string) => void {
    return (phase: SetupPhase, message: string): void => {
      if (!spinner) return
      if (phase === SetupPhase.COMPLETE) {
        spinner.succeed('Setup complete')
      } else if (phase === SetupPhase.ROLLBACK) {
        spinner.fail(message || 'Setup failed, rolling back...')
      } else {
        spinner.text = message || `Processing: ${phase}...`
      }
    }
  }

  private formatDryRun(
    flags: Record<string, unknown>,
    targetPath: string,
    info: WorktreeInfo,
    setupResult: SetupResult,
    kind: WorktreeKind,
    sourceBranch: string,
    chalk: Awaited<typeof import('chalk').default> | null,
    warnings: string[]
  ): void {
    const plan = setupResult.plan ?? {
      symlinks: { toCreate: [], alreadyLinked: [], conflicts: [] },
      rsyncFileCount: 0,
      rsyncMode: 'skipped' as const,
    }

    if (flags.json) {
      this.log(
        JSON.stringify(
          {
            success: true,
            dryRun: true,
            worktree: { path: targetPath, branch: info.branch, commit: info.commit },
            plan,
            wouldWrite: { kind, sourceBranch, owner: flags.owner ?? null, ttl: flags.ttl ?? null },
            warnings: [...setupResult.warnings, ...warnings],
          },
          null,
          2
        )
      )
      return
    }

    if (!chalk) {
      ErrorHelper.unexpected(this, new Error('Chalk not initialized for human-readable output'))
    }
    const out: string[] = []
    out.push(chalk.cyan(`Dry run — would adopt ${targetPath}`))
    if (info.branch) out.push(chalk.gray(`  Branch: ${info.branch}`))
    out.push('')
    out.push(chalk.bold('Symlinks:'))
    out.push(chalk.green(`  create: ${plan.symlinks.toCreate.length}`))
    out.push(chalk.gray(`  already linked: ${plan.symlinks.alreadyLinked.length}`))
    if (plan.symlinks.conflicts.length > 0) {
      const verb = flags['replace-existing'] ? 'replace' : 'skip (real file present)'
      out.push(chalk.yellow(`  ${verb}: ${plan.symlinks.conflicts.length}`))
      plan.symlinks.conflicts.forEach((item) => out.push(chalk.yellow(`    • ${item}`)))
    }
    out.push('')
    out.push(chalk.bold('Rsync:'))
    out.push(chalk.gray(`  mode: ${plan.rsyncMode}, files: ${plan.rsyncFileCount}`))
    out.push('')
    out.push(chalk.bold('Metadata that would be written:'))
    out.push(chalk.gray(`  kind: ${kind}, sourceBranch: ${sourceBranch}`))
    if (flags.owner) out.push(chalk.gray(`  owner: ${flags.owner as string}`))
    if (flags.ttl) out.push(chalk.gray(`  ttl: ${flags.ttl as string}`))
    for (const w of [...setupResult.warnings, ...warnings]) {
      out.push(chalk.yellow(`⚠ ${w}`))
    }
    out.push('')
    out.push(chalk.cyan('No changes made. Re-run without --dry-run to apply.'))
    this.log(out.join('\n'))
  }

  private formatOutput(args: {
    flags: Record<string, unknown>
    targetPath: string
    info: WorktreeInfo
    setupResult: SetupResult
    lifecycle: AddLifecycleResult
    postCommandResults: PostCommandResult[]
    alreadyManaged: boolean
    preexistingDirtyPaths: string[]
    duration: number
    chalk: Awaited<typeof import('chalk').default> | null
    warnings: string[]
  }): void {
    const {
      flags,
      targetPath,
      info,
      setupResult,
      lifecycle,
      postCommandResults,
      alreadyManaged,
      preexistingDirtyPaths,
      duration,
      chalk,
      warnings,
    } = args
    const allWarnings = [
      ...setupResult.warnings,
      ...warnings,
      ...(lifecycle.notice ? [lifecycle.notice] : []),
      ...lifecycle.warnings,
    ]

    if (flags.json) {
      this.log(
        JSON.stringify(
          {
            success: true,
            adopted: true,
            alreadyManaged,
            worktree: {
              path: targetPath,
              branch: info.branch,
              commit: info.commit,
              kind: lifecycle.kind,
              ...(lifecycle.owner ? { owner: lifecycle.owner } : {}),
              ...(lifecycle.ttl ? { ttl: lifecycle.ttl } : {}),
              ...(lifecycle.effectiveTtl ? { effectiveTtl: lifecycle.effectiveTtl } : {}),
              ...(lifecycle.ports ? { ports: lifecycle.ports } : {}),
              ...(lifecycle.dbName ? { dbName: lifecycle.dbName } : {}),
              locked: lifecycle.locked,
            },
            setup: {
              rsync: setupResult.rsyncResult
                ? {
                    filesTransferred: setupResult.rsyncResult.filesTransferred,
                    totalSize: setupResult.rsyncResult.totalSize,
                  }
                : null,
              symlink: setupResult.symlinkResult
                ? {
                    created: setupResult.symlinkResult.created,
                    skipped: setupResult.symlinkResult.skipped,
                    conflictCount: setupResult.symlinkResult.conflicts.length,
                    conflicts: setupResult.symlinkResult.conflicts,
                  }
                : null,
              alreadyLinked: setupResult.plan?.symlinks.alreadyLinked ?? [],
              cleanTree: setupResult.cleanTree ?? null,
            },
            preexistingDirty: preexistingDirtyPaths,
            postCommands: postCommandResults,
            duration,
            warnings: allWarnings,
          },
          null,
          2
        )
      )
      return
    }

    if (!chalk) {
      ErrorHelper.unexpected(this, new Error('Chalk not initialized for human-readable output'))
    }
    const out: string[] = []
    out.push(chalk.green(`✓ Adopted ${targetPath}`))
    if (info.branch) out.push(chalk.gray(`  Branch: ${info.branch}`))
    out.push(chalk.gray(`  Commit: ${info.commit.substring(0, 7)}`))
    const status = [
      ...(lifecycle.locked ? ['locked'] : []),
      ...(lifecycle.owner ? [`owner ${lifecycle.owner}`] : []),
      ...(lifecycle.ttl ? [`ttl ${lifecycle.ttl}`] : []),
    ]
    out.push(
      chalk.gray(`  Kind: ${lifecycle.kind}${status.length > 0 ? ` (${status.join(', ')})` : ''}`)
    )
    const resources = [
      ...Object.entries(lifecycle.ports ?? {}).map(([name, port]) => `${name}=${port}`),
      ...(lifecycle.dbName ? [`db=${lifecycle.dbName}`] : []),
    ]
    if (resources.length > 0) out.push(chalk.gray(`  Resources: ${resources.join(', ')}`))
    out.push('')

    if (setupResult.rsyncResult) {
      const { filesTransferred, totalSize } = setupResult.rsyncResult
      const mb = (totalSize / (1024 * 1024)).toFixed(2)
      out.push(chalk.green(`✓ Files synced: ${filesTransferred.toLocaleString()} files (${mb} MB)`))
    }
    if (setupResult.symlinkResult) {
      const { created, conflicts } = setupResult.symlinkResult
      if (created > 0) out.push(chalk.green(`✓ Symlinks created: ${created}`))
      const alreadyLinked = setupResult.plan?.symlinks.alreadyLinked.length ?? 0
      if (alreadyLinked > 0) out.push(chalk.gray(`  Symlinks already in place: ${alreadyLinked}`))
      if (conflicts.length > 0) {
        out.push(
          chalk.yellow(
            `⚠ Symlinks skipped (real file present): ${conflicts.length}` +
              ` — use --replace-existing to replace`
          )
        )
        conflicts.forEach((c) => out.push(chalk.yellow(`    • ${c.target} (${c.reason})`)))
      }
    }
    if (preexistingDirtyPaths.length > 0) {
      out.push(
        chalk.gray(`  Preserved ${preexistingDirtyPaths.length} pre-existing change(s) untouched`)
      )
    }
    if (postCommandResults.length > 0) {
      out.push('')
      out.push(chalk.cyan('Post-command scripts:'))
      postCommandResults.forEach((result) => {
        const label = result.name ? `${result.name} (${result.command})` : result.command
        out.push(chalk.green(`  ✓ ${label}`))
      })
    }
    if (setupResult.cleanTree === false) {
      out.push(chalk.yellow('⚠ git status is not clean in the worktree'))
    }
    if (allWarnings.length > 0) {
      out.push('')
      out.push(chalk.yellow('⚠ Warnings:'))
      allWarnings.forEach((w) => out.push(chalk.yellow(`  - ${w}`)))
    }
    out.push('')
    out.push(chalk.cyan(`Ready to use: cd ${targetPath}`))
    out.push(chalk.gray(`Duration: ${(duration / 1000).toFixed(2)}s`))
    this.log(out.join('\n'))
  }

  private handleError(
    error: unknown,
    flags: Record<string, unknown>,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    warnings: string[]
  ): void {
    if (isOclifExitError(error)) throw error
    if (spinner) spinner.fail('Failed')

    if (error instanceof PostCommandError) {
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: error.message,
              postCommands: error.results,
              failedPostCommand: error.result,
              warnings,
            },
            null,
            2
          )
        )
        this.exit(1)
      }
      ErrorHelper.operation(this, error, `Post-command failed: ${error.result.command}`, false)
      return
    }

    // SetupError: adopt never removes the worktree, so make that explicit.
    if (error instanceof Error && error.name === 'SetupError') {
      const setupError = error as Error & { result?: { warnings?: string[] } }
      const combined = [...(setupError.result?.warnings ?? []), ...warnings]
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: setupError.message,
              worktreePreserved: true,
              warnings: combined,
            },
            null,
            2
          )
        )
        this.exit(1)
      }
      ErrorHelper.operation(
        this,
        setupError,
        'Adopt failed; the worktree and your changes were left untouched',
        false
      )
      return
    }

    if (flags.json) {
      this.log(
        JSON.stringify(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            warnings,
          },
          null,
          2
        )
      )
      this.exit(1)
    }
    ErrorHelper.operation(
      this,
      error instanceof Error ? error : new Error(String(error)),
      'Adopt failed',
      false
    )
  }
}
