import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { enumerateAll, writeMetadata } from './worktreeMetadata.js'

type PortProbe = (port: number) => Promise<boolean>
type AddressProbeResult = 'free' | 'taken' | 'unsupported'

export interface AllocateOptions {
  range: string
  names: string[]
  mainRepoPath: string
  isPortFree?: PortProbe
}

const SERVICE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/
const MAX_RECONCILE_ATTEMPTS = 3

function parseRange(range: string): [start: number, end: number] | undefined {
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(range)
  if (!match) return undefined

  const start = Number(match[1])
  const end = Number(match[2])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end > 65_535 ||
    start > end
  ) {
    return undefined
  }

  return [start, end]
}

function probeAddress(
  port: number,
  host: string,
  allowUnsupported: boolean
): Promise<AddressProbeResult> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => {
      const result =
        allowUnsupported && (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL')
          ? 'unsupported'
          : 'taken'

      // An errored listener may still retain resources; ignore any close error.
      server.close(() => resolve(result))
    })
    server.listen(port, host, () => {
      // Waiting for close prevents the transient probe itself from retaining the port.
      server.close(() => resolve('free'))
    })
  })
}

async function probePort(port: number): Promise<boolean> {
  const ipv4 = await probeAddress(port, '127.0.0.1', false)
  const ipv6 = await probeAddress(port, '::1', true)
  return ipv4 === 'free' && (ipv6 === 'free' || ipv6 === 'unsupported')
}

async function findFreePort(
  start: number,
  end: number,
  taken: Set<number>,
  isPortFree: PortProbe
): Promise<number | undefined> {
  for (let port = start; port <= end; port += 1) {
    if (taken.has(port)) continue

    let free = false
    try {
      free = await isPortFree(port)
    } catch {
      // Probe failures cannot establish availability, so reserving is the safe default.
    }

    if (!free) {
      taken.add(port)
      continue
    }

    return port
  }

  return undefined
}

function plainPorts(ports: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(ports))
}

export async function allocate(
  worktreePath: string,
  opts: AllocateOptions
): Promise<Record<string, number>> {
  const ports: Record<string, number> = Object.create(null) as Record<string, number>
  const range = parseRange(opts.range)
  const taken = new Set<number>()
  const isPortFree = opts.isPortFree ?? probePort

  if (range) {
    const worktrees = await enumerateAll(opts.mainRepoPath)
    for (const { metadata } of worktrees) {
      for (const port of Object.values(metadata.ports ?? {})) taken.add(port)
    }

    const [start, end] = range

    for (const name of opts.names) {
      if (!SERVICE_NAME_PATTERN.test(name) || Object.hasOwn(ports, name)) continue

      const port = await findFreePort(start, end, taken, isPortFree)
      if (port === undefined) continue

      ports[name] = port
      taken.add(port)
    }
  }

  await writeMetadata(worktreePath, { ports: plainPorts(ports) })

  if (range && Object.keys(ports).length > 0) {
    const [start, end] = range

    for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
      const worktrees = await enumerateAll(opts.mainRepoPath)
      const peerPorts = new Set<number>()

      for (const { worktreePath: peerPath, metadata } of worktrees) {
        if (peerPath === worktreePath) continue
        for (const port of Object.values(metadata.ports ?? {})) peerPorts.add(port)
      }

      const collidingNames = Object.entries(ports)
        .filter(([, port]) => peerPorts.has(port))
        .map(([name]) => name)
      if (collidingNames.length === 0) break

      for (const port of peerPorts) taken.add(port)
      for (const name of collidingNames) {
        const replacement = await findFreePort(start, end, taken, isPortFree)
        if (replacement === undefined) {
          delete ports[name]
          continue
        }

        ports[name] = replacement
        taken.add(replacement)
      }

      await writeMetadata(worktreePath, { ports: plainPorts(ports) })
    }
  }

  return plainPorts(ports)
}

export function deriveDbName(base: string, branch: string): string {
  const sanitizedBranch = branch
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
  const suffix = sanitizedBranch || createHash('sha1').update(branch).digest('hex').slice(0, 8)
  return `${base}_${suffix}`
}
