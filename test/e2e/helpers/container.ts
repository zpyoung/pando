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

export async function createE2EContainer(): Promise<E2EContainer> {
  const projectRoot = path.resolve(__dirname, '../../..')
  const dockerfilePath = path.resolve(__dirname, '..')

  // Select Dockerfile and image name based on mode
  const dockerfile = isPublishedMode ? 'Dockerfile.published' : 'Dockerfile'
  const imageName = isPublishedMode ? 'pando-e2e-published' : 'pando-e2e-test'

  // Build custom image with git + rsync (+ pando from npm in published mode)
  const container = await GenericContainer.fromDockerfile(dockerfilePath, dockerfile).build(
    imageName,
    {
      deleteOnExit: false,
    }
  )

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
      try {
        json = JSON.parse(result.stdout.trim())
      } catch {
        // Not valid JSON, leave undefined
      }
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
