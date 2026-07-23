import type { Command } from '@oclif/core'
import type { LoadedPandoConfig } from '../config/loader.js'
import { ErrorHelper } from './errors.js'
import {
  computeConfigHash,
  decidePostCommandTrust,
  isConfigTrusted,
  isEnvTrustEnabled,
  recordTrust,
} from './configTrust.js'
import {
  normalizePostCommandScripts,
  runPostCommandScripts,
  type PostCommandContext,
  type PostCommandResult,
  type PostCommandScriptConfig,
} from './postCommands.js'

type Spinner = Awaited<ReturnType<typeof import('ora').default>>

export interface RunTrustedPostCommandsParams {
  command: Command
  config: LoadedPandoConfig
  /** The running command, e.g. 'add' | 'adopt'. Used in messaging + PANDO_COMMAND. */
  commandName: string
  /** Config key to read scripts from (usually === commandName). */
  scriptKey: string
  /** Fallback config key when `scriptKey` has no scripts (adopt falls back to 'add'). */
  fallbackScriptKey?: string
  context: Omit<PostCommandContext, 'commandName'>
  isJson: boolean
  spinner: Spinner | null
  warnings: string[]
}

function emitWarning(command: Command, message: string, isJson: boolean, warnings: string[]): void {
  if (isJson) {
    warnings.push(message)
  } else {
    ErrorHelper.warn(command, message, false)
  }
}

/**
 * Run a command's configured post-command scripts, gated by the direnv-style
 * config trust check. Shared by `pando add` and `pando adopt` so the trust
 * semantics stay identical.
 *
 * @returns The results of each executed script (empty if none ran / not trusted)
 */
export async function runTrustedPostCommands(
  params: RunTrustedPostCommandsParams
): Promise<PostCommandResult[]> {
  const { command, config, commandName, scriptKey, fallbackScriptKey, context, isJson, spinner } =
    params
  const { warnings } = params

  let scripts = normalizePostCommandScripts(config, scriptKey)
  if (scripts.length === 0 && fallbackScriptKey) {
    scripts = normalizePostCommandScripts(config, fallbackScriptKey)
  }

  if (scripts.length === 0) {
    return []
  }

  // ============================================================
  // Trust gate (direnv-style): post-commands run with shell: true,
  // so a config file from a freshly-cloned repo must be explicitly
  // trusted before its scripts execute. See src/utils/configTrust.ts.
  // ============================================================
  const allowed = await evaluatePostCommandTrust(
    command,
    config.postCommandsSourcePath,
    scripts,
    commandName,
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

  return runPostCommandScripts(scripts, { commandName, ...context })
}

/**
 * Decide whether post-commands from a config file are allowed to run, and
 * persist trust when the user approves interactively.
 *
 * @returns True if the post-commands should run; false to skip them
 */
async function evaluatePostCommandTrust(
  command: Command,
  sourcePath: string | undefined,
  scripts: PostCommandScriptConfig[],
  commandName: string,
  isJson: boolean,
  spinner: Spinner | null,
  warnings: string[]
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
    emitWarning(
      command,
      `Skipping ${scripts.length} post-command script(s) from untrusted config file` +
        (sourcePath ? ` '${sourcePath}'` : '') +
        '.\n' +
        `To allow them: run \`pando ${commandName}\` interactively once to trust this file, ` +
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
    command.log('')
    command.log(`A config file requests running post-command scripts on 'pando ${commandName}':`)
    if (sourcePath) {
      command.log(`  File: ${sourcePath}`)
    }
    for (const script of scripts) {
      const label = script.name ? `${script.name}: ${script.command}` : script.command
      command.log(`  • ${label}`)
    }
    command.log('')
  }

  const { confirm } = await import('@inquirer/prompts')
  const approved = await confirm({
    message: 'Trust this config file and run its post-commands?',
    default: false,
  })

  if (!approved) {
    emitWarning(
      command,
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
      emitWarning(
        command,
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
