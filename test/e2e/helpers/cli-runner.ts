import type { E2EContainer, PandoResult } from './container.js'

export interface PandoCommand {
  command: string
  args?: string[]
  cwd?: string
  json?: boolean
}

export async function runPando(
  container: E2EContainer,
  cmd: PandoCommand
): Promise<PandoResult> {
  const args = [cmd.command, ...(cmd.args || [])]

  if (cmd.json) {
    args.push('--json')
  }

  return container.execPando(args, cmd.cwd)
}

// Convenience functions for each command
export function pandoAdd(
  container: E2EContainer,
  cwd: string,
  args: string[]
): Promise<PandoResult> {
  return runPando(container, { command: 'add', args, cwd, json: true })
}

export function pandoList(
  container: E2EContainer,
  cwd: string
): Promise<PandoResult> {
  return runPando(container, { command: 'list', cwd, json: true })
}

export function pandoRemove(
  container: E2EContainer,
  cwd: string,
  args: string[]
): Promise<PandoResult> {
  return runPando(container, { command: 'remove', args, cwd, json: true })
}

export function pandoSymlink(
  container: E2EContainer,
  cwd: string,
  args: string[]
): Promise<PandoResult> {
  return runPando(container, { command: 'symlink', args, cwd, json: true })
}

export function pandoConfigInit(
  container: E2EContainer,
  cwd: string,
  args: string[] = []
): Promise<PandoResult> {
  return runPando(container, { command: 'config init', args, cwd, json: true })
}

export function pandoConfigShow(
  container: E2EContainer,
  cwd: string,
  args: string[] = []
): Promise<PandoResult> {
  return runPando(container, { command: 'config show', args, cwd, json: true })
}
