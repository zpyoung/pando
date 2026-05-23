import { spawn } from 'child_process'
import type { PandoConfig } from '../config/schema.js'

export interface PostCommandScriptConfig {
  name?: string
  command: string
}

export interface PostCommandContext {
  commandName: string
  cwd: string
  worktreePath: string
  branch: string | null
  commit: string
}

export interface PostCommandResult {
  name: string | null
  command: string
  cwd: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  success: boolean
  duration: number
}

export class PostCommandError extends Error {
  constructor(
    message: string,
    public readonly result: PostCommandResult,
    public readonly results: PostCommandResult[]
  ) {
    super(message)
    this.name = 'PostCommandError'
  }
}

export function normalizePostCommandScripts(
  config: PandoConfig,
  commandName: string
): PostCommandScriptConfig[] {
  const configured = config.postCommands?.[commandName] ?? []

  return configured.map((entry) =>
    typeof entry === 'string'
      ? { command: entry }
      : {
          name: entry.name,
          command: entry.command,
        }
  )
}

export async function runPostCommandScripts(
  scripts: PostCommandScriptConfig[],
  context: PostCommandContext
): Promise<PostCommandResult[]> {
  const results: PostCommandResult[] = []

  for (const script of scripts) {
    const result = await runPostCommandScript(script, context)
    results.push(result)

    if (!result.success) {
      const label = result.name ? `${result.name} (${result.command})` : result.command
      throw new PostCommandError(`Post-command script failed: ${label}`, result, results)
    }
  }

  return results
}

async function runPostCommandScript(
  script: PostCommandScriptConfig,
  context: PostCommandContext
): Promise<PostCommandResult> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    const child = spawn(script.command, {
      cwd: context.cwd,
      shell: true,
      env: {
        ...process.env,
        PANDO_COMMAND: context.commandName,
        PANDO_WORKTREE_PATH: context.worktreePath,
        PANDO_BRANCH: context.branch ?? '',
        PANDO_COMMIT: context.commit,
      },
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      resolve({
        name: script.name ?? null,
        command: script.command,
        cwd: context.cwd,
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr + error.message,
        success: false,
        duration: Date.now() - startTime,
      })
    })

    child.on('close', (exitCode, signal) => {
      resolve({
        name: script.name ?? null,
        command: script.command,
        cwd: context.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        success: exitCode === 0,
        duration: Date.now() - startTime,
      })
    })
  })
}
