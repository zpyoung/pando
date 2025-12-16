import type { E2EContainer } from './container.js'

export interface GitRepoOptions {
  name: string
  branches?: string[]
  files?: Array<{ path: string; content: string }>
  commits?: number
}

export async function setupGitRepo(
  container: E2EContainer,
  options: GitRepoOptions
): Promise<string> {
  const repoPath = await container.createGitRepo(options.name)

  // Add additional files
  if (options.files && options.files.length > 0) {
    for (const file of options.files) {
      const fullPath = `${repoPath}/${file.path}`
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      await container.exec(['mkdir', '-p', dir])
      // Escape content for shell
      const escapedContent = file.content.replace(/'/g, "'\\''")
      await container.exec(['sh', '-c', `echo '${escapedContent}' > ${fullPath}`])
    }
    await container.exec(['sh', '-c', `cd ${repoPath} && git add . && git commit -m "Add files"`])
  }

  // Create additional branches
  if (options.branches && options.branches.length > 0) {
    for (const branch of options.branches) {
      await container.exec(['sh', '-c', `cd ${repoPath} && git branch ${branch}`])
    }
  }

  // Add more commits if requested
  if (options.commits && options.commits > 1) {
    for (let i = 2; i <= options.commits; i++) {
      await container.exec([
        'sh',
        '-c',
        `cd ${repoPath} && echo "commit ${i}" >> history.txt && git add . && git commit -m "Commit ${i}"`,
      ])
    }
  }

  return repoPath
}

export function getWorktreePath(basePath: string, name: string): string {
  return `${basePath}/../worktrees/${name}`
}
