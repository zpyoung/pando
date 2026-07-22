import { Args, Command, Flags } from '@oclif/core'
import { createGitHelper } from '../utils/git.js'
import { loadConfig } from '../config/loader.js'
import { parseBoolean } from '../config/env.js'
import type { PandoConfig } from '../config/schema.js'
import {
  assertGitVersion,
  ensureWorktreeConfigEnabled,
  writeMetadata,
  type WorktreeMetadata,
} from '../utils/worktreeMetadata.js'
import { allocate, deriveDbName } from '../utils/portAllocator.js'
import { createWorktreeSetupOrchestrator, SetupPhase } from '../utils/worktreeSetup.js'
import { jsonFlag, pathFlag } from '../utils/common-flags.js'
import { ErrorHelper, isOclifExitError } from '../utils/errors.js'
import { validateBranchName } from '../utils/validation.js'
import {
  computeConfigHash,
  decidePostCommandTrust,
  isConfigTrusted,
  isEnvTrustEnabled,
  recordTrust,
} from '../utils/configTrust.js'
import { buildAddCommandDetails, type AddCommandDetails } from '../utils/commandDetails.js'
import {
  normalizePostCommandScripts,
  PostCommandError,
  runPostCommandScripts,
  type PostCommandResult,
} from '../utils/postCommands.js'

type WorktreeKind = NonNullable<WorktreeMetadata['kind']>

type LifecycleGitHelper = Pick<
  ReturnType<typeof createGitHelper>,
  'getMainBranch' | 'inferOwner' | 'lockWorktree'
>

interface LifecycleDependencies {
  assertGitVersion: () => Promise<void>
  ensureWorktreeConfigEnabled: typeof ensureWorktreeConfigEnabled
  writeMetadata: typeof writeMetadata
  allocate: typeof allocate
}

interface LifecycleOptions {
  flags: Record<string, unknown>
  worktreeConfig: PandoConfig['worktree']
  portsConfig: PandoConfig['ports']
  gitHelper: LifecycleGitHelper
  gitRoot: string
  mainRepoPath: string
  resolvedPath: string
  sourceBranch?: string
  env?: NodeJS.ProcessEnv
  createdAt?: string
}

export interface AddLifecycleResult {
  kind: WorktreeKind
  owner?: string
  ttl?: string
  effectiveTtl?: string
  ports?: Record<string, number>
  dbName?: string
  locked: boolean
  notice?: string
  warnings: string[]
}

const lifecycleDependencies: LifecycleDependencies = {
  assertGitVersion,
  ensureWorktreeConfigEnabled,
  writeMetadata,
  allocate,
}

/** Resolve lifecycle kind without coupling precedence rules to command I/O. */
export function resolveWorktreeKind(
  flags: Record<string, unknown>,
  configuredKind: PandoConfig['worktree']['defaultKind'],
  resolvedPath: string,
  env: NodeJS.ProcessEnv = process.env
): WorktreeKind {
  if (flags.ephemeral) return 'ephemeral'
  if (flags['long-lived']) return 'long-lived'
  if (configuredKind === 'ephemeral' || configuredKind === 'long-lived') return configuredKind

  const normalizedPath = resolvedPath.replaceAll('\\', '/')
  const hasAgentSession = env.CLAUDE_SESSION_ID !== undefined || env.PANDO_SESSION !== undefined
  const hasEphemeralSignal = env.PANDO_EPHEMERAL !== undefined && parseBoolean(env.PANDO_EPHEMERAL)
  const isAgentWorktree =
    normalizedPath.includes('/.claude/worktrees/') || hasAgentSession || hasEphemeralSignal

  return isAgentWorktree ? 'ephemeral' : 'long-lived'
}

/**
 * Lifecycle setup is best-effort because a usable worktree is more valuable
 * than failing the whole add after setup has already completed.
 */
export async function setupLifecycleMetadata(
  options: LifecycleOptions,
  dependencies: LifecycleDependencies = lifecycleDependencies
): Promise<AddLifecycleResult> {
  const { flags, worktreeConfig, portsConfig, gitHelper, gitRoot, mainRepoPath, resolvedPath } =
    options
  const env = options.env ?? process.env
  const kind = resolveWorktreeKind(flags, worktreeConfig.defaultKind, resolvedPath, env)
  const owner = (flags.owner as string | undefined) ?? gitHelper.inferOwner()
  const hasActiveSession = env.CLAUDE_SESSION_ID !== undefined || env.PANDO_SESSION !== undefined
  const ttl = flags.ttl as string | undefined
  const effectiveTtl = ttl ?? (kind === 'ephemeral' ? worktreeConfig.ephemeralTtl : undefined)
  const result: AddLifecycleResult = {
    kind,
    ...(owner ? { owner } : {}),
    ...(ttl ? { ttl } : {}),
    ...(effectiveTtl !== undefined ? { effectiveTtl } : {}),
    locked: false,
    warnings: [],
  }

  try {
    await dependencies.assertGitVersion()
    const enablement = await dependencies.ensureWorktreeConfigEnabled(gitRoot)
    if (enablement.notice) result.notice = enablement.notice

    const sourceBranch = options.sourceBranch ?? (await gitHelper.getMainBranch())
    await dependencies.writeMetadata(resolvedPath, {
      kind,
      createdAt: options.createdAt ?? new Date().toISOString(),
      sourceBranch,
      ...(owner ? { owner } : {}),
      ...(ttl ? { ttl } : {}),
    })

    if (worktreeConfig.autoLockActive && hasActiveSession) {
      await gitHelper.lockWorktree(resolvedPath, `pando: active session ${owner}`)
      result.locked = true
    }

    if (portsConfig.enabled) {
      try {
        const allocatedPorts = await dependencies.allocate(resolvedPath, {
          range: portsConfig.range,
          names: portsConfig.names,
          mainRepoPath,
        })
        result.ports = allocatedPorts

        const skippedNames = portsConfig.names.filter(
          (name) => !Object.hasOwn(allocatedPorts, name)
        )
        if (skippedNames.length > 0) {
          result.warnings.push(
            `Could not allocate requested port(s) for ${skippedNames.join(', ')} in range ${portsConfig.range}`
          )
        }

        if (portsConfig.dbStrategy === 'named') {
          const dbName = deriveDbName(portsConfig.dbBaseName, sourceBranch)
          result.dbName = dbName
          await dependencies.writeMetadata(resolvedPath, { dbName })
        }
      } catch (error) {
        // Resource setup cannot invalidate a worktree that was already created successfully.
        const reason = error instanceof Error ? error.message : String(error)
        result.warnings.push(`Could not allocate worktree ports or database name: ${reason}`)
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    result.warnings.push(`Could not fully initialize worktree lifecycle metadata: ${reason}`)
  }

  return result
}

interface CreatedWorktreeInfo {
  path: string
  branch: string | null
  commit: string
  rebased?: boolean
  rebaseSourceBranch?: string
  sourceBranch?: string
}

interface AddWorktreeOutput {
  path: string
  branch: string | null
  commit: string
  rebased: boolean
  rebaseSourceBranch: string | null
  kind: WorktreeKind
  owner?: string
  ttl?: string
  effectiveTtl?: string
  ports?: Record<string, number>
  dbName?: string
  locked: boolean
}

interface AddOutputContext {
  warnings: string[]
  setupWarnings: string[]
  worktreeInfo?: CreatedWorktreeInfo
  lifecycle?: AddLifecycleResult
}

function buildWorktreeOutput(
  worktreeInfo: CreatedWorktreeInfo,
  lifecycle: AddLifecycleResult
): AddWorktreeOutput {
  return {
    path: worktreeInfo.path,
    branch: worktreeInfo.branch,
    commit: worktreeInfo.commit,
    rebased: worktreeInfo.rebased || false,
    rebaseSourceBranch: worktreeInfo.rebaseSourceBranch || null,
    kind: lifecycle.kind,
    ...(lifecycle.owner ? { owner: lifecycle.owner } : {}),
    ...(lifecycle.ttl ? { ttl: lifecycle.ttl } : {}),
    ...(lifecycle.effectiveTtl ? { effectiveTtl: lifecycle.effectiveTtl } : {}),
    ...(lifecycle.ports ? { ports: lifecycle.ports } : {}),
    ...(lifecycle.dbName ? { dbName: lifecycle.dbName } : {}),
    locked: lifecycle.locked,
  }
}

function lifecycleWarnings(lifecycle?: AddLifecycleResult): string[] {
  if (!lifecycle) return []
  return [...(lifecycle.notice ? [lifecycle.notice] : []), ...lifecycle.warnings]
}

/**
 * Add a new git worktree
 *
 * Creates a new working tree linked to the current repository.
 * After creation, optionally rsyncs files and creates symlinks
 * based on configuration.
 */
export default class AddWorktree extends Command {
  static description = 'Add a new git worktree with optional rsync and symlink setup'

  static examples = [
    '<%= config.bin %> <%= command.id %> feature-x',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x',
    '<%= config.bin %> <%= command.id %> --path ../hotfix --branch hotfix --commit abc123',
    '<%= config.bin %> <%= command.id %> --path ../feature-y --branch feature-y --json',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --skip-rsync',
    '<%= config.bin %> <%= command.id %> --path ../feature-x --branch feature-x --symlink "package.json"',
  ]

  static args = {
    branch: Args.string({
      description: 'Branch name to checkout or create',
      required: false,
    }),
  }

  static flags = {
    // Basic worktree flags
    path: pathFlag,
    branch: Flags.string({
      char: 'b',
      description: 'Branch to checkout or create',
      required: false,
    }),
    commit: Flags.string({
      char: 'c',
      description: 'Commit hash to base the new branch on',
      required: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force create branch even if it exists (uses git worktree add -B)',
      default: false,
    }),
    'no-rebase': Flags.boolean({
      description: 'Skip rebasing existing branch onto source branch',
      default: false,
    }),

    // Lifecycle flags
    ephemeral: Flags.boolean({
      description: 'Mark the worktree as ephemeral',
      exclusive: ['long-lived'],
      default: false,
    }),
    'long-lived': Flags.boolean({
      description: 'Mark the worktree as long-lived',
      exclusive: ['ephemeral'],
      default: false,
    }),
    ttl: Flags.string({
      description: 'Set a per-worktree lifecycle duration',
    }),
    owner: Flags.string({
      description: 'Set the worktree owner or agent session id',
    }),
    ports: Flags.boolean({
      description: 'Enable port allocation for this run',
      default: false,
    }),

    // Rsync control flags
    'skip-rsync': Flags.boolean({
      description: 'Skip rsync operation (ignore config)',
      default: false,
    }),
    'rsync-flags': Flags.string({
      description: 'Override rsync flags (comma-separated)',
      multiple: true,
    }),
    'rsync-exclude': Flags.string({
      description: 'Additional rsync exclude patterns',
      multiple: true,
    }),

    // Symlink control flags
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

    // Output flags
    details: Flags.boolean({
      description: 'Show detailed setup information after the worktree is created',
      default: false,
    }),
    json: jsonFlag,
  }

  async run(): Promise<void> {
    const { flags, args } = await this.parse(AddWorktree)
    const outputContext: AddOutputContext = { warnings: [], setupWarnings: [] }

    // Use positional arg as branch if --branch is not provided
    if (args.branch && !flags.branch) {
      flags.branch = args.branch
    }

    // Validate the branch name (positional arg or --branch flag) early, before
    // any worktree/setup work, so an invalid name fails fast with a clear reason.
    if (flags.branch) {
      const branchValidation = validateBranchName(flags.branch)
      if (!branchValidation.valid) {
        this.failValidation(
          `Invalid branch name '${flags.branch}': ${branchValidation.reason}`,
          flags.json,
          outputContext.warnings
        )
      }
    }

    const startTime = Date.now()

    const { spinner, chalk } = await this.initializeUI(flags.json)

    try {
      // Initialize git helper first to get git root
      const gitHelper = createGitHelper()
      const isRepo = await gitHelper.isRepository()
      if (!isRepo) {
        this.failValidation(
          'Not a git repository. Run this command from within a git repository.',
          flags.json,
          outputContext.warnings
        )
      }

      // Load config before validation so we can use default path
      const config = await this.loadAndMergeConfig(
        flags as Record<string, unknown>,
        gitHelper,
        spinner,
        outputContext.warnings
      )

      // Get git root for path resolution
      const gitRoot = await gitHelper.getRepositoryRoot()

      // Validate and initialize with config
      const { gitHelper: _gitHelper, resolvedPath } = await this.validateAndInitialize(
        flags as Record<string, unknown>,
        spinner,
        config,
        gitRoot,
        outputContext.warnings
      )

      const worktreeInfo = await this.createWorktree(
        flags as Record<string, unknown>,
        gitHelper,
        resolvedPath,
        spinner,
        config,
        outputContext.warnings
      )
      outputContext.worktreeInfo = worktreeInfo

      const setupResult = await this.runSetup(
        flags as Record<string, unknown>,
        config,
        gitHelper,
        resolvedPath,
        spinner
      )
      outputContext.setupWarnings = setupResult.warnings

      // A linked worktree root can still enumerate peers if discovering the main path fails.
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
        resolvedPath,
        sourceBranch: worktreeInfo.sourceBranch,
      })
      outputContext.lifecycle = lifecycle
      if (!flags.json) {
        if (lifecycle.notice) ErrorHelper.warn(this, lifecycle.notice, false)
        lifecycle.warnings.forEach((warning) => ErrorHelper.warn(this, warning, false))
      }
      const postCommandResults = await this.runPostCommands(
        flags as Record<string, unknown>,
        config,
        worktreeInfo,
        resolvedPath,
        spinner,
        lifecycle.kind,
        lifecycle.effectiveTtl,
        lifecycle.ports,
        lifecycle.dbName,
        outputContext.warnings
      )
      this.formatOutput(
        flags as Record<string, unknown>,
        worktreeInfo,
        setupResult,
        lifecycle,
        postCommandResults,
        Date.now() - startTime,
        chalk,
        outputContext.warnings
      )
    } catch (error) {
      await this.handleError(error, flags as Record<string, unknown>, chalk, spinner, outputContext)
    }
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

  private failOperation(error: Error, context: string, isJson: boolean, warnings: string[]): never {
    if (!isJson) return ErrorHelper.operation(this, error, context, false)

    this.log(
      JSON.stringify(
        {
          success: false,
          error: `${context}: ${error.message}`,
          context,
          details: error.message,
          warnings,
        },
        null,
        2
      )
    )
    this.exit(1)
  }

  /**
   * Initialize UI components (spinner and chalk)
   */
  private async initializeUI(isJson: boolean): Promise<{
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
    chalk: Awaited<typeof import('chalk').default> | null
  }> {
    const ora = !isJson ? (await import('ora')).default : null
    const spinner = ora ? ora() : null
    const chalk = !isJson ? (await import('chalk')).default : null

    return { spinner, chalk }
  }

  /**
   * Phase 1: Initialize and validate
   */
  private async validateAndInitialize(
    flags: Record<string, unknown>,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    config: Awaited<ReturnType<typeof loadConfig>>,
    gitRoot: string,
    warnings: string[] = []
  ): Promise<{ gitHelper: ReturnType<typeof createGitHelper>; resolvedPath: string }> {
    if (spinner) {
      spinner.start('Validating path...')
    }

    const gitHelper = createGitHelper()

    // Narrow string flags from the erased Record<string, unknown> to their
    // actual oclif types (all defined via Flags.string -> string | undefined).
    const pathArg = flags.path as string | undefined
    const branchArg = flags.branch as string | undefined
    const commitArg = flags.commit as string | undefined

    // Resolve path: CLI flag > config default > error
    const fs = await import('fs-extra')
    // Validate: require either --branch or --path (or both)
    if (!branchArg && !pathArg) {
      this.failValidation('Either --branch or --path is required.', Boolean(flags.json), warnings)
    }

    const path = await import('path')
    let worktreePath: string

    if (pathArg) {
      // Path provided via flag
      worktreePath = pathArg
    } else if (config.worktree.defaultPath && branchArg) {
      // Use config default path + branch name
      // Sanitize branch name: convert slashes to underscores for filesystem safety
      const sanitizedBranch = branchArg.replace(/\//g, '_')

      // Insert project subfolder if enabled
      if (config.worktree.useProjectSubfolder) {
        const projectName = path.basename(gitRoot)
        worktreePath = path.join(config.worktree.defaultPath, projectName, sanitizedBranch)
      } else {
        worktreePath = path.join(config.worktree.defaultPath, sanitizedBranch)
      }
    } else {
      // No path flag and no usable config default
      this.failValidation(
        'Path is required. Provide --path flag or set worktree.defaultPath in config.',
        Boolean(flags.json),
        warnings
      )
    }

    // Resolve path (relative to git root if not absolute)
    const resolvedPath = path.isAbsolute(worktreePath)
      ? worktreePath
      : path.resolve(gitRoot, worktreePath)

    if (await fs.pathExists(resolvedPath)) {
      this.failValidation(`Path already exists: ${resolvedPath}`, Boolean(flags.json), warnings)
    }

    // Ensure parent directory exists (needed for useProjectSubfolder and nested defaultPath)
    await fs.ensureDir(path.dirname(resolvedPath))

    // Validate force flag requires branch
    if (flags.force && !branchArg) {
      this.failValidation(
        'The --force flag requires --branch to be specified.\n\n' +
          'The --force flag resets an existing branch to a new commit.\n' +
          'Without a branch name, there is nothing to force-reset.\n\n' +
          'Options:\n' +
          '  • Add --branch <name> to specify the branch to reset\n' +
          '  • Remove --force if creating a new worktree without resetting',
        Boolean(flags.json),
        warnings
      )
    }

    // Validate branch/commit combination when force is NOT set
    if (branchArg && commitArg && !flags.force) {
      // Check if branch already exists
      const branchExists = await gitHelper.branchExists(branchArg)
      if (branchExists) {
        this.failValidation(
          `Branch '${branchArg}' already exists.\n\n` +
            'Options:\n' +
            `  • Use --force to reset '${branchArg}' to commit ${commitArg.substring(0, 7)}\n` +
            '  • Choose a different branch name with --branch <new-name>\n' +
            '  • Omit --branch to checkout the commit in detached HEAD state',
          Boolean(flags.json),
          warnings
        )
      }
    }

    return { gitHelper, resolvedPath }
  }

  /**
   * Phase 2: Load configuration
   */
  private async loadAndMergeConfig(
    flags: Record<string, unknown>,
    gitHelper: ReturnType<typeof createGitHelper>,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    warnings: string[] = []
  ): Promise<Awaited<ReturnType<typeof loadConfig>>> {
    if (spinner) {
      spinner.text = 'Loading configuration...'
    }

    // Get git root directory
    const gitRoot = await gitHelper.getRepositoryRoot()

    // Load config from all sources (includes environment variables automatically)
    let config = await loadConfig({
      cwd: process.cwd(),
      gitRoot,
    })

    // Apply flag overrides
    if (flags['skip-rsync']) {
      config.rsync.enabled = false
      // Warn if rsync-specific flags were provided alongside --skip-rsync
      if (flags['rsync-flags'] || flags['rsync-exclude']) {
        this.emitWarning(
          '--rsync-flags and --rsync-exclude are ignored when --skip-rsync is set',
          Boolean(flags.json),
          warnings
        )
      }
    }
    if (flags['rsync-flags']) {
      const rsyncFlags = flags['rsync-flags'] as string[]
      config.rsync.flags = rsyncFlags.flatMap((f: string) => f.split(','))
    }
    if (flags['rsync-exclude']) {
      const rsyncExclude = flags['rsync-exclude'] as string[]
      config.rsync.exclude = [
        ...config.rsync.exclude,
        ...rsyncExclude.flatMap((e: string) => e.split(',')),
      ]
    }
    if (flags['skip-symlink']) {
      config.symlink.patterns = []
    }
    if (flags.symlink) {
      const symlinkPatterns = flags.symlink as string[]
      config.symlink.patterns = symlinkPatterns.flatMap((s: string) => s.split(','))
    }
    if (flags['absolute-symlinks']) {
      config.symlink.relative = false
    }
    if (flags.ports) {
      // Allocation lands in T8; preserving the run-level override now keeps the
      // flag contract stable for that phase without allocating prematurely.
      config.ports.enabled = true
    }

    return config
  }

  /**
   * Phase 3: Create worktree
   */
  private async createWorktree(
    flags: Record<string, unknown>,
    gitHelper: ReturnType<typeof createGitHelper>,
    resolvedPath: string,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    config: Awaited<ReturnType<typeof loadConfig>>,
    warnings: string[] = []
  ): Promise<CreatedWorktreeInfo> {
    if (spinner) {
      spinner.text = 'Creating worktree...'
    }

    // Get source branch BEFORE creating worktree (we're on it now)
    let sourceBranch: string | null = null
    try {
      sourceBranch = await gitHelper.getCurrentBranch()
    } catch {
      // In detached HEAD state, can't determine source branch
      sourceBranch = null
    }

    let worktreeResult
    try {
      worktreeResult = await gitHelper.addWorktree(resolvedPath, {
        branch: flags.branch as string | undefined,
        commit: flags.commit as string | undefined,
        force: flags.force as boolean | undefined,
        skipPostCreate: true,
      })
    } catch (error) {
      this.failOperation(error as Error, 'Failed to create worktree', Boolean(flags.json), warnings)
    }

    // Determine if we should rebase
    const shouldRebase =
      worktreeResult.isExistingBranch &&
      config.worktree.rebaseOnAdd !== false &&
      !flags['no-rebase'] &&
      sourceBranch !== null &&
      worktreeResult.branch !== sourceBranch // Don't rebase onto itself

    let rebased = false
    if (shouldRebase && worktreeResult.branch) {
      if (spinner) {
        spinner.text = `Rebasing ${worktreeResult.branch} onto ${sourceBranch}...`
      }

      const rebaseSuccess = await gitHelper.rebaseBranchInWorktree(resolvedPath, sourceBranch!)

      if (rebaseSuccess) {
        rebased = true
        // Update commit hash after rebase
        const gitInWorktree = (await import('simple-git')).simpleGit(resolvedPath)
        const newCommit = await gitInWorktree.revparse(['HEAD'])
        worktreeResult.commit = newCommit.trim()
      } else {
        // Warn but don't fail
        this.emitWarning(
          `Failed to rebase ${worktreeResult.branch} onto ${sourceBranch}. You may need to rebase manually.`,
          Boolean(flags.json),
          warnings
        )
      }
    }

    return {
      path: worktreeResult.path,
      branch: worktreeResult.branch,
      commit: worktreeResult.commit,
      rebased,
      rebaseSourceBranch: rebased ? sourceBranch! : undefined,
      sourceBranch: sourceBranch ?? undefined,
    }
  }

  /**
   * Phase 4: Post-creation setup
   */
  private async runSetup(
    flags: Record<string, unknown>,
    config: Awaited<ReturnType<typeof loadConfig>>,
    gitHelper: ReturnType<typeof createGitHelper>,
    resolvedPath: string,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null
  ): Promise<
    Awaited<ReturnType<ReturnType<typeof createWorktreeSetupOrchestrator>['setupNewWorktree']>> & {
      details: AddCommandDetails
    }
  > {
    const orchestrator = createWorktreeSetupOrchestrator(gitHelper, config)

    const setupOptions = {
      skipRsync: flags['skip-rsync'] as boolean | undefined,
      skipSymlink: flags['skip-symlink'] as boolean | undefined,

      onProgress: this.buildProgressCallback(spinner, flags.json as boolean),
    }

    // Register a SIGINT (Ctrl+C) handler so an interruption mid-setup triggers
    // the same transactional rollback as a thrown error (otherwise the signal
    // would bypass the catch block and leave a partial worktree behind).
    const interruptHandler = this.createSetupInterruptHandler(
      orchestrator,
      spinner,
      Boolean(flags.json)
    )
    // Node's signal listeners are `() => void`; wrap the async handler in a
    // void-returning fire-and-forget listener (it ends in process.exit anyway).
    const sigintListener = (): void => {
      void interruptHandler()
    }
    process.once('SIGINT', sigintListener)

    try {
      const result = await orchestrator.setupNewWorktree(resolvedPath, setupOptions)
      const details = buildAddCommandDetails({
        rsyncResult: result.rsyncResult,
        symlinkResult: result.symlinkResult,
        transactionOperations: orchestrator.getTransaction().getOperations(),
        worktreePath: resolvedPath,
      })

      return { ...result, details }
    } catch (error) {
      if (spinner) {
        spinner.fail('Setup failed')
      }
      throw error
    } finally {
      // Remove the listener once setup completes (success or failure) so it
      // can't fire later for an unrelated reason.
      process.removeListener('SIGINT', sigintListener)
    }
  }

  /**
   * Build a SIGINT handler that rolls back an in-progress worktree setup.
   *
   * Extracted as a factory (rather than an inline closure) so unit tests can
   * invoke the handler directly without sending a real signal. The handler:
   *   1. stops the spinner,
   *   2. runs the orchestrator's transactional rollback,
   *   3. prints a brief 'Interrupted — rolled back' message,
   *   4. exits with code 130 (128 + SIGINT).
   *
   * @param orchestrator - The active setup orchestrator
   * @param spinner - Active spinner to stop (may be null in JSON mode)
   * @returns An async SIGINT handler
   */
  createSetupInterruptHandler(
    orchestrator: ReturnType<typeof createWorktreeSetupOrchestrator>,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    isJson = false
  ): () => Promise<void> {
    return async (): Promise<void> => {
      if (spinner) {
        spinner.stop()
      }
      try {
        await orchestrator.rollback()
      } catch {
        // Rollback already swallows its own errors and returns warnings; this
        // guard only protects against unexpected throws so we still exit 130.
      }
      if (!isJson) {
        this.log('\nInterrupted — rolled back')
      }
      // 130 = 128 + SIGINT(2), the conventional exit code for Ctrl+C.
      process.exit(130)
    }
  }

  /**
   * Build progress callback for setup operations
   */
  private buildProgressCallback(
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    isJson: boolean
  ): (phase: SetupPhase, message: string) => void {
    return (phase: SetupPhase, message: string): void => {
      if (spinner) {
        // Update spinner with phase-specific messages
        switch (phase) {
          case SetupPhase.INIT:
            spinner.text = 'Initializing setup...'
            break
          case SetupPhase.CHECKPOINT:
            spinner.text = 'Creating checkpoint...'
            break
          case SetupPhase.SYMLINK_BEFORE:
            spinner.text = 'Creating symlinks (before rsync)...'
            break
          case SetupPhase.RSYNC:
            // Use dynamic message from rsync progress (e.g., "Syncing files: 45/120 (37%)")
            spinner.text = message || 'Syncing files with rsync...'
            break
          case SetupPhase.SYMLINK_AFTER:
            spinner.text = 'Creating symlinks (after rsync)...'
            break
          case SetupPhase.VALIDATION:
            spinner.text = 'Validating setup...'
            break
          case SetupPhase.COMPLETE:
            spinner.succeed('Setup complete')
            break
          case SetupPhase.ROLLBACK:
            // Include context from message if available
            spinner.fail(message || 'Setup failed, rolling back...')
            break
          default:
            // Handle any new phases that might be added in the future
            spinner.text = message || `Processing: ${phase}...`
            break
        }
      } else if (isJson) {
        // Log phase changes for JSON mode (silent unless debugging)
        // Could add verbose flag later to control this
      }
    }
  }

  private async runPostCommands(
    flags: Record<string, unknown>,
    config: Awaited<ReturnType<typeof loadConfig>>,
    worktreeInfo: {
      path: string
      branch: string | null
      commit: string
    },
    resolvedPath: string,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    kind: WorktreeKind,
    ttl?: string,
    ports?: Record<string, number>,
    dbName?: string,
    warnings: string[] = []
  ): Promise<PostCommandResult[]> {
    const scripts = normalizePostCommandScripts(config, 'add')

    if (scripts.length === 0) {
      return []
    }

    const isJson = Boolean(flags.json)

    // ============================================================
    // Trust gate (direnv-style): post-commands run with shell: true,
    // so a config file from a freshly-cloned repo must be explicitly
    // trusted before its scripts execute. See src/utils/configTrust.ts.
    // ============================================================
    const allowed = await this.evaluatePostCommandTrust(
      config.postCommandsSourcePath,
      scripts,
      isJson,
      spinner,
      warnings
    )
    if (!allowed) {
      return []
    }

    if (spinner) {
      spinner.text = `Running ${scripts.length} post-command script${scripts.length === 1 ? '' : 's'}...`
    }

    return runPostCommandScripts(scripts, {
      commandName: 'add',
      cwd: resolvedPath,
      worktreePath: worktreeInfo.path,
      branch: worktreeInfo.branch,
      commit: worktreeInfo.commit,
      kind,
      ttl,
      ...(ports ? { ports } : {}),
      ...(dbName ? { dbName } : {}),
    })
  }

  /**
   * Decide whether post-commands from a config file are allowed to run, and
   * persist trust when the user approves interactively.
   *
   * @returns True if the post-commands should run; false to skip them
   */
  private async evaluatePostCommandTrust(
    sourcePath: string | undefined,
    scripts: Array<{ name?: string; command: string }>,
    isJson: boolean,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    warnings: string[] = []
  ): Promise<boolean> {
    const envTrust = isEnvTrustEnabled(process.env.PANDO_TRUST_CONFIG)

    // Only hash/check trust when there is an actual file on disk to vet.
    let currentHash: string | undefined
    let trustedWithMatchingHash = false
    if (sourcePath && !envTrust) {
      try {
        currentHash = await computeConfigHash(sourcePath)
        trustedWithMatchingHash = await isConfigTrusted(sourcePath, currentHash)
      } catch {
        // If we cannot read/hash the file, treat it as untrusted.
        trustedWithMatchingHash = false
      }
    }

    const isTty = Boolean(process.stdin.isTTY)

    const decision = decidePostCommandTrust({
      hasScripts: scripts.length > 0,
      sourcePath,
      envTrust,
      trustedWithMatchingHash,
      isTty,
      isJson,
    })

    if (decision === 'run') {
      return true
    }

    if (decision === 'skip') {
      this.emitWarning(
        `Skipping ${scripts.length} post-command script(s) from untrusted config file` +
          (sourcePath ? ` '${sourcePath}'` : '') +
          '.\n' +
          'To allow them: run `pando add` interactively once to trust this file, ' +
          'or set PANDO_TRUST_CONFIG=1.',
        isJson,
        warnings
      )
      return false
    }

    // decision === 'prompt' (interactive TTY, not JSON)
    // Pause the spinner so the inquirer prompt renders cleanly. By this point
    // the spinner has typically already succeeded (setup completed), so it is
    // usually NOT spinning — but it may still be active if a caller invokes the
    // trust gate mid-setup. The wasSpinning guard handles both cases: we only
    // stop a spinner that is actually running, and only restart it afterward if
    // we stopped it (see the matching `if (spinner && wasSpinning)` below).
    const wasSpinning = Boolean(spinner?.isSpinning)
    if (spinner && wasSpinning) {
      spinner.stop()
    }

    if (!isJson) {
      this.log('')
      this.log(`A config file requests running post-command scripts on 'pando add':`)
      if (sourcePath) {
        this.log(`  File: ${sourcePath}`)
      }
      for (const script of scripts) {
        const label = script.name ? `${script.name}: ${script.command}` : script.command
        this.log(`  • ${label}`)
      }
      this.log('')
    }

    const { confirm } = await import('@inquirer/prompts')
    const approved = await confirm({
      message: 'Trust this config file and run its post-commands?',
      default: false,
    })

    if (!approved) {
      this.emitWarning(
        `Skipped ${scripts.length} post-command script(s); config file not trusted.`,
        isJson,
        warnings
      )
      return false
    }

    // Persist trust at the current content hash, then run.
    if (sourcePath) {
      try {
        const hash = currentHash ?? (await computeConfigHash(sourcePath))
        await recordTrust(sourcePath, hash)
      } catch {
        // Non-fatal: failing to persist trust just means we'll prompt again
        // next time. Still allow this run since the user approved it.
        this.emitWarning(
          'Could not persist trust decision; will prompt again next time.',
          isJson,
          warnings
        )
      }
    }

    if (spinner && wasSpinning) {
      spinner.start()
    }

    return true
  }

  /**
   * Phase 5: Output formatting
   */
  private formatOutput(
    flags: Record<string, unknown>,
    worktreeInfo: CreatedWorktreeInfo,
    setupResult: Awaited<
      ReturnType<ReturnType<typeof createWorktreeSetupOrchestrator>['setupNewWorktree']>
    > & { details: AddCommandDetails },
    lifecycle: AddLifecycleResult,
    postCommandResults: PostCommandResult[],
    duration: number,
    chalk: Awaited<typeof import('chalk').default> | null,
    warnings: string[] = []
  ): void {
    if (flags.json) {
      const worktreeOutput = buildWorktreeOutput(worktreeInfo, lifecycle)

      this.log(
        JSON.stringify(
          {
            success: true,
            worktree: worktreeOutput,
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
              skipWorktree: setupResult.skipWorktreeResult
                ? {
                    filesMarked: setupResult.skipWorktreeResult.filesMarked,
                    success: setupResult.skipWorktreeResult.success,
                  }
                : null,
              // null = the status check could not run; automation should treat
              // false as "worktree needs inspection" (details in warnings)
              cleanTree: setupResult.cleanTree ?? null,
            },
            postCommands: postCommandResults,
            duration,
            warnings: [...setupResult.warnings, ...warnings, ...lifecycleWarnings(lifecycle)],
            ...(flags.details ? { details: setupResult.details } : {}),
          },
          null,
          2
        )
      )
    } else {
      // Human-readable output
      if (!chalk) {
        ErrorHelper.unexpected(this, new Error('Chalk not initialized for human-readable output'))
      }
      const output: string[] = []

      // Success header
      output.push(chalk.green(`✓ Worktree created at ${worktreeInfo.path}`))
      if (worktreeInfo.branch) {
        const branchInfo = worktreeInfo.rebased
          ? `${worktreeInfo.branch} (rebased onto ${worktreeInfo.rebaseSourceBranch})`
          : worktreeInfo.branch
        output.push(chalk.gray(`  Branch: ${branchInfo}`))
      }
      output.push(chalk.gray(`  Commit: ${worktreeInfo.commit.substring(0, 7)}`))
      const lifecycleStatus = [
        ...(lifecycle.locked ? ['locked'] : []),
        ...(lifecycle.owner ? [`owner ${lifecycle.owner}`] : []),
        ...(lifecycle.ttl ? [`ttl ${lifecycle.ttl}`] : []),
      ]
      output.push(
        chalk.gray(
          `  Kind: ${lifecycle.kind}${lifecycleStatus.length > 0 ? ` (${lifecycleStatus.join(', ')})` : ''}`
        )
      )
      const resourceStatus = [
        ...Object.entries(lifecycle.ports ?? {}).map(([name, port]) => `${name}=${port}`),
        ...(lifecycle.dbName ? [`db=${lifecycle.dbName}`] : []),
      ]
      if (resourceStatus.length > 0) {
        output.push(chalk.gray(`  Resources: ${resourceStatus.join(', ')}`))
      }
      output.push('')

      // Rsync results
      if (setupResult.rsyncResult) {
        const { filesTransferred, totalSize } = setupResult.rsyncResult
        const mbTotal = (totalSize / (1024 * 1024)).toFixed(2)
        output.push(
          chalk.green(`✓ Files synced: ${filesTransferred.toLocaleString()} files (${mbTotal} MB)`)
        )
      }

      // Symlink results
      if (setupResult.symlinkResult) {
        const { created, skipped, conflicts } = setupResult.symlinkResult
        if (created > 0) {
          output.push(chalk.green(`✓ Symlinks created: ${created} files`))
        }
        if (skipped > 0) {
          output.push(chalk.yellow(`⚠ Symlinks skipped: ${skipped} files`))
        }
        if (conflicts.length > 0) {
          output.push(chalk.yellow(`⚠ Symlink conflicts: ${conflicts.length} files`))
          // Show conflict details
          conflicts.forEach((conflict: { source: string; target: string; reason: string }) => {
            output.push(chalk.yellow(`    • ${conflict.target}`))
            output.push(chalk.gray(`      Source: ${conflict.source}`))
            output.push(chalk.gray(`      Reason: ${conflict.reason}`))
          })
        }
      }

      if (postCommandResults.length > 0) {
        output.push('')
        output.push(chalk.cyan('Post-command scripts:'))
        postCommandResults.forEach((result) => {
          const label = result.name ? `${result.name} (${result.command})` : result.command
          output.push(chalk.green(`  ✓ ${label}`))
          output.push(chalk.gray(`    cwd: ${result.cwd}`))
          output.push(chalk.gray(`    exit: ${result.exitCode ?? 'signal ' + result.signal}`))
          if (result.stdout.trim().length > 0) {
            output.push(chalk.gray('    stdout:'))
            result.stdout
              .trimEnd()
              .split('\n')
              .forEach((line) => output.push(chalk.gray(`      ${line}`)))
          }
          if (result.stderr.trim().length > 0) {
            output.push(chalk.gray('    stderr:'))
            result.stderr
              .trimEnd()
              .split('\n')
              .forEach((line) => output.push(chalk.gray(`      ${line}`)))
          }
        })
      }

      if (flags.details) {
        output.push('')
        output.push(chalk.cyan('Details:'))

        if (setupResult.details.rsync) {
          const mbTotal = (setupResult.details.rsync.totalSize / (1024 * 1024)).toFixed(2)
          output.push(
            chalk.gray(
              `  Rsync: ${setupResult.details.rsync.filesTransferred.toLocaleString()} files, ${mbTotal} MB, ${(
                setupResult.details.rsync.duration / 1000
              ).toFixed(2)}s`
            )
          )
        } else {
          output.push(chalk.gray('  Rsync: not run'))
        }

        if (setupResult.details.symlink) {
          output.push(
            chalk.gray(
              `  Symlinks: ${setupResult.details.symlink.created.toLocaleString()} created, ${setupResult.details.symlink.skipped.toLocaleString()} skipped, ${setupResult.details.symlink.conflictCount.toLocaleString()} conflicts`
            )
          )

          if (setupResult.details.symlink.samples.length > 0) {
            output.push(chalk.gray('  Symlink paths:'))
            setupResult.details.symlink.samples.forEach((sample) => {
              output.push(
                chalk.gray(
                  `    • ${sample.path} -> ${sample.linkPath ?? sample.source ?? 'unknown'}`
                )
              )
            })
          }
        } else {
          output.push(chalk.gray('  Symlinks: not run'))
        }
      }

      // Clean-tree check (details are in the warnings section)
      if (setupResult.cleanTree === false) {
        output.push(chalk.yellow('⚠ git status is not clean in the new worktree'))
      }

      // Warnings
      if (setupResult.warnings.length > 0) {
        output.push('')
        output.push(chalk.yellow('⚠ Warnings:'))
        setupResult.warnings.forEach((warning: string) => {
          output.push(chalk.yellow(`  - ${warning}`))
        })
      }

      // Footer
      output.push('')
      output.push(chalk.cyan(`Ready to use: cd ${worktreeInfo.path}`))
      output.push(chalk.gray(`Duration: ${(duration / 1000).toFixed(2)}s`))

      this.log(output.join('\n'))
    }
  }

  /**
   * Centralized error handling
   */
  private async handleError(
    error: unknown,
    flags: Record<string, unknown>,
    chalk: Awaited<typeof import('chalk').default> | null,
    spinner: Awaited<ReturnType<typeof import('ora').default>> | null,
    outputContext: AddOutputContext = { warnings: [], setupWarnings: [] }
  ): Promise<void> {
    if (isOclifExitError(error)) {
      throw error
    }

    const warnings = [
      ...outputContext.setupWarnings,
      ...outputContext.warnings,
      ...lifecycleWarnings(outputContext.lifecycle),
    ]

    if (spinner) {
      spinner.fail('Failed')
    }

    if (error instanceof PostCommandError) {
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: error.message,
              ...(outputContext.worktreeInfo && outputContext.lifecycle
                ? {
                    worktree: buildWorktreeOutput(
                      outputContext.worktreeInfo,
                      outputContext.lifecycle
                    ),
                  }
                : {}),
              postCommands: error.results,
              failedPostCommand: error.result,
              warnings,
            },
            null,
            2
          )
        )
        this.exit(1)
      } else {
        const result = error.result
        const details = [
          `Command: ${result.command}`,
          `Working directory: ${result.cwd}`,
          `Exit: ${result.exitCode ?? 'signal ' + result.signal}`,
        ]
        if (result.stdout.trim().length > 0) {
          details.push(`Stdout:\n${result.stdout.trimEnd()}`)
        }
        if (result.stderr.trim().length > 0) {
          details.push(`Stderr:\n${result.stderr.trimEnd()}`)
        }
        ErrorHelper.operation(this, error, details.join('\n\n'), false)
      }
      return
    }

    // Handle SetupError
    if (error instanceof Error && error.name === 'SetupError') {
      const setupError = error as Error & {
        result: {
          rolledBack: boolean
          warnings: string[]
          duration: number
          symlinkResult?: { conflicts: Array<{ source: string; target: string; reason: string }> }
        }
      }
      const result = setupError.result

      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: setupError.message,
              rolledBack: result.rolledBack,
              warnings: [...result.warnings, ...warnings],
              duration: result.duration,
              symlinkConflicts: result.symlinkResult?.conflicts || [],
            },
            null,
            2
          )
        )
      } else {
        if (!chalk) {
          ErrorHelper.unexpected(this, new Error('Chalk not initialized for error output'))
        }

        // Build error message with symlink conflicts if present
        let errorMessage = 'Setup failed'
        if (result.symlinkResult?.conflicts && result.symlinkResult.conflicts.length > 0) {
          const conflictDetails = result.symlinkResult.conflicts
            .map((c) => `  • Target: ${c.target}\n    Source: ${c.source}\n    Reason: ${c.reason}`)
            .join('\n\n')
          errorMessage +=
            `\n\nSymlink conflicts (${result.symlinkResult.conflicts.length}):\n\n` +
            conflictDetails +
            '\n\nResolve conflicts manually or use --skip-symlink'
        }

        ErrorHelper.operation(
          this,
          setupError,
          errorMessage,
          false // Not JSON mode
        )
      }
      return
    }

    // Handle RsyncNotInstalledError
    const { RsyncNotInstalledError } = await import('../utils/fileOps.js')
    if (error instanceof RsyncNotInstalledError) {
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: 'rsync is not installed',
              hint: 'Install rsync or use --skip-rsync flag',
              warnings,
            },
            null,
            2
          )
        )
      } else {
        if (!chalk) {
          ErrorHelper.unexpected(this, new Error('Chalk not initialized for error output'))
        }
        ErrorHelper.validation(
          this,
          'rsync is not installed or not in PATH\n\nInstall rsync to use file syncing:\n  • macOS: brew install rsync\n  • Ubuntu/Debian: apt install rsync\n  • Windows: Install via WSL or use --skip-rsync\n\nOr skip rsync with: --skip-rsync',
          false // Not JSON mode
        )
      }
      return
    }

    // Handle SymlinkConflictError
    const { SymlinkConflictError } = await import('../utils/fileOps.js')
    if (
      error instanceof SymlinkConflictError &&
      'conflicts' in error &&
      Array.isArray(error.conflicts)
    ) {
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              success: false,
              error: 'symlink conflicts',
              conflicts: error.conflicts,
              warnings,
            },
            null,
            2
          )
        )
      } else {
        const conflictDetails = error.conflicts
          .map(
            (c: { source: string; target: string; reason: string }) =>
              `  • Target: ${c.target}\n    Source: ${c.source}\n    Reason: ${c.reason}`
          )
          .join('\n\n')
        ErrorHelper.operation(
          this,
          error as Error,
          'Symlink conflicts detected:\n\n' +
            conflictDetails +
            '\n\nResolve conflicts manually or use --skip-symlink',
          false // Not JSON mode
        )
      }
      return
    }

    // Generic error
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
    } else {
      ErrorHelper.operation(
        this,
        error instanceof Error ? error : new Error(String(error)),
        'Operation failed',
        false // Not JSON mode
      )
    }
  }
}
