import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Detect mode from environment - tests against published npm package when true
const isPublishedMode = process.env.PANDO_E2E_PUBLISHED === 'true'

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface PandoResult extends ExecResult {
  json?: Record<string, unknown>
}

export interface E2EContainer {
  container: StartedTestContainer
  exec: (cmd: string[]) => Promise<ExecResult>
  execPando: (args: string[], cwd?: string) => Promise<PandoResult>
  createGitRepo: (name: string) => Promise<string>
  stop: () => Promise<void>
  /** True if testing against published npm package */
  isPublishedMode: boolean
}

/**
 * Parse the first valid JSON object/array from a command's stdout.
 *
 * Some commands (notably `remove` on its error path) currently emit more than
 * one JSON line to stdout — the legitimate payload followed by a stray
 * `{"success":false,"error":"EEXIT: 1"}` from re-serializing the oclif exit
 * error. `JSON.parse` over the whole blob fails in that case. We therefore try
 * the trimmed whole string first (the common, single-object case) and fall back
 * to the first line that parses on its own, which is always the real payload.
 *
 * The fallback path also counts how many lines parse as standalone JSON: if
 * MORE than one does, that's a double-emit regression (the documented `remove`
 * workaround is the only known case). We still return the first object, but
 * emit a console.warn naming the command so a new double-emit in another
 * command isn't silently swallowed.
 *
 * @param stdout - Raw command stdout
 * @param command - Human-readable command label (e.g. the joined argv) used in
 *   the multi-object warning so regressions are attributable.
 */
function parseFirstJsonObject(
  stdout: string,
  command?: string
): Record<string, unknown> | undefined {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // Multi-object stdout: parse every line, keep the first that is valid JSON,
    // but count all parseable objects so we can flag unexpected double-emits.
    let first: Record<string, unknown> | undefined
    let jsonLineCount = 0
    for (const line of trimmed.split('\n')) {
      const candidate = line.trim()
      if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
        continue
      }
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>
        jsonLineCount++
        if (first === undefined) {
          first = parsed
        }
      } catch {
        // keep scanning
      }
    }

    if (jsonLineCount > 1) {
      console.warn(
        `[e2e] parseFirstJsonObject: command "${command ?? 'unknown'}" emitted ` +
          `${jsonLineCount} JSON object lines on stdout; returning the first. ` +
          `This is expected only for the documented \`remove\` workaround — a new ` +
          `occurrence elsewhere indicates a double-emit regression.`
      )
    }

    return first
  }

  return undefined
}

export async function createE2EContainer(): Promise<E2EContainer> {
  const projectRoot = path.resolve(__dirname, '../../..')
  const dockerfilePath = path.resolve(__dirname, '..')

  // Select Dockerfile and image name based on mode
  const dockerfile = isPublishedMode ? 'Dockerfile.published' : 'Dockerfile'
  // In published mode the image is version-specific, so bake the version into
  // the image name to avoid reusing a cached image built for another version.
  const publishedVersion = process.env.PANDO_VERSION?.trim() || 'latest'
  const imageName = isPublishedMode ? `pando-e2e-published-${publishedVersion}` : 'pando-e2e-test'

  // Build custom image with git + rsync (+ pando from npm in published mode).
  // In published mode, pin the installed package to PANDO_VERSION via build arg
  // (the release workflow sets it from the tag); defaults to `latest` locally.
  let imageBuilder = GenericContainer.fromDockerfile(dockerfilePath, dockerfile)
  if (isPublishedMode) {
    imageBuilder = imageBuilder.withBuildArgs({ PANDO_VERSION: publishedVersion })
  }
  const container = await imageBuilder.build(imageName, {
    deleteOnExit: false,
  })

  // Start container builder
  let containerBuilder = container.withWorkingDir('/app').withCommand(['tail', '-f', '/dev/null'])

  // Only copy local build files in local mode (not published mode)
  if (!isPublishedMode) {
    containerBuilder = containerBuilder
      .withCopyDirectoriesToContainer([
        { source: path.join(projectRoot, 'dist'), target: '/app/dist' },
        { source: path.join(projectRoot, 'bin'), target: '/app/bin' },
        {
          source: path.join(projectRoot, 'node_modules'),
          target: '/app/node_modules',
        },
      ])
      .withCopyFilesToContainer([
        {
          source: path.join(projectRoot, 'package.json'),
          target: '/app/package.json',
        },
      ])
  }

  const startedContainer = await containerBuilder.start()

  const execFn = async (cmd: string[]): Promise<ExecResult> => {
    const result = await startedContainer.exec(cmd)
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }
  }

  // CLI invocation differs based on mode
  const cliCommand = isPublishedMode ? 'pando' : 'node /app/bin/run.js'

  const execPandoFn = async (args: string[], cwd?: string): Promise<PandoResult> => {
    let result: ExecResult

    if (cwd) {
      // Run from specific directory
      const shellCmd = `cd ${cwd} && ${cliCommand} ${args.join(' ')}`
      result = await execFn(['sh', '-c', shellCmd])
    } else {
      if (isPublishedMode) {
        result = await execFn(['pando', ...args])
      } else {
        result = await execFn(['node', '/app/bin/run.js', ...args])
      }
    }

    let json: Record<string, unknown> | undefined
    if (args.includes('--json')) {
      json = parseFirstJsonObject(result.stdout, `pando ${args.join(' ')}`)
    }

    return { ...result, json }
  }

  const createGitRepoFn = async (name: string): Promise<string> => {
    const repoPath = `/repos/${name}`
    await execFn(['mkdir', '-p', repoPath])
    await execFn(['git', 'init', repoPath])
    await execFn([
      'sh',
      '-c',
      `cd ${repoPath} && echo "# ${name}" > README.md && git add . && git commit -m "Initial commit"`,
    ])
    return repoPath
  }

  return {
    container: startedContainer,
    exec: execFn,
    execPando: execPandoFn,
    createGitRepo: createGitRepoFn,
    stop: async () => {
      await startedContainer.stop()
    },
    isPublishedMode,
  }
}
