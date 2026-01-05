/**
 * Integration tests for project-level config loading with add command
 *
 * These tests validate GitHub Issue #6: Project-level .pando.toml ignored
 * https://github.com/zpyoung/pando/issues/6
 *
 * Tests the full flow: config discovery -> loading -> add command path resolution
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { ConfigLoader, discoverConfigFiles, loadConfig } from '../../src/config/loader'
import { ConfigSource } from '../../src/config/schema'

describe('Project Config Integration (Issue #6)', () => {
  let tempDir: string
  let gitRoot: string
  let _git: SimpleGit
  let loader: ConfigLoader

  /**
   * Setup a real git repository for testing
   */
  async function initGitRepo(dir: string): Promise<SimpleGit> {
    const g = simpleGit(dir)
    await g.init()
    await g.addConfig('user.email', 'test@test.com')
    await g.addConfig('user.name', 'Test User')
    // Create initial commit so we have a valid HEAD
    const readmePath = path.join(dir, 'README.md')
    await fs.writeFile(readmePath, '# Test Project')
    await g.add('README.md')
    await g.commit('Initial commit')
    return g
  }

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-integration-'))
    gitRoot = tempDir

    // Initialize a real git repository
    _git = await initGitRepo(gitRoot)

    // Fresh config loader for each test
    loader = new ConfigLoader()
  })

  afterEach(async () => {
    // Clean up temporary directory
    await fs.remove(tempDir)
  })

  describe('Config Discovery in Real Git Repo', () => {
    it('should discover .pando.toml at git root', async () => {
      // Create .pando.toml at git root
      const configPath = path.join(gitRoot, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      const configFiles = await discoverConfigFiles(gitRoot, gitRoot)

      // Find .pando.toml in discovered files
      const pandoToml = configFiles.find(
        (f) => f.source === ConfigSource.PANDO_TOML && f.path === configPath
      )

      expect(pandoToml).toBeDefined()
      expect(pandoToml?.exists).toBe(true)
    })

    it('should discover .pando.toml from subdirectory', async () => {
      // Create nested subdirectory
      const subDir = path.join(gitRoot, 'src', 'components')
      await fs.ensureDir(subDir)

      // Create .pando.toml at git root
      const configPath = path.join(gitRoot, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      // Discover from subdirectory
      const configFiles = await discoverConfigFiles(subDir, gitRoot)

      // Should still find .pando.toml at root
      const pandoToml = configFiles.find(
        (f) => f.source === ConfigSource.PANDO_TOML && f.path === configPath
      )

      expect(pandoToml).toBeDefined()
      expect(pandoToml?.exists).toBe(true)
    })
  })

  describe('Config Loading with worktree.defaultPath', () => {
    it('should load worktree.defaultPath from .pando.toml', async () => {
      // Create .pando.toml with defaultPath
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      expect(config.worktree.defaultPath).toBe('../worktrees')
    })

    it('should load worktree.defaultPath from subdirectory', async () => {
      // Create .pando.toml at root
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      // Create subdirectory
      const subDir = path.join(gitRoot, 'src')
      await fs.ensureDir(subDir)

      // Load config from subdirectory
      const config = await loadConfig({ cwd: subDir, gitRoot, skipCache: true })

      expect(config.worktree.defaultPath).toBe('../worktrees')
    })

    it('should return undefined defaultPath when not configured', async () => {
      // Create .pando.toml WITHOUT defaultPath
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[rsync]
enabled = true
`
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      expect(config.worktree.defaultPath).toBeUndefined()
    })

    it('should load all worktree config options', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
useProjectSubfolder = true
rebaseOnAdd = false
targetBranch = "develop"
deleteBranchOnRemove = "remote"
`
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      expect(config.worktree.defaultPath).toBe('../worktrees')
      expect(config.worktree.useProjectSubfolder).toBe(true)
      expect(config.worktree.rebaseOnAdd).toBe(false)
      expect(config.worktree.targetBranch).toBe('develop')
      expect(config.worktree.deleteBranchOnRemove).toBe('remote')
    })
  })

  describe('Config Source Tracking', () => {
    it('should track worktree.defaultPath source as PANDO_TOML', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      const result = await loader.loadWithSources({ cwd: gitRoot, gitRoot })

      expect(result.sources['worktree.defaultPath']).toBe(ConfigSource.PANDO_TOML)
    })

    it('should track worktree.defaultPath source as ENV_VARS when set via env', async () => {
      const originalEnv = process.env

      try {
        process.env = {
          ...originalEnv,
          PANDO_WORKTREE_DEFAULT_PATH: '../env-worktrees',
        }

        const result = await loader.loadWithSources({ cwd: gitRoot, gitRoot })

        expect(result.config.worktree.defaultPath).toBe('../env-worktrees')
        expect(result.sources['worktree.defaultPath']).toBe(ConfigSource.ENV_VARS)
      } finally {
        process.env = originalEnv
      }
    })
  })

  describe('Add Command Path Resolution Simulation', () => {
    /**
     * Simulates the path resolution logic from add.ts:validateAndInitialize
     * This tests the same logic without executing the full command
     */
    function resolveWorktreePath(
      flags: { path?: string; branch?: string },
      config: { worktree: { defaultPath?: string; useProjectSubfolder?: boolean } },
      gitRoot: string
    ): { resolvedPath: string | null; error: string | null } {
      let worktreePath: string | undefined

      if (flags.path) {
        worktreePath = flags.path
      } else if (config.worktree.defaultPath && flags.branch) {
        const sanitizedBranch = flags.branch.replace(/\//g, '_')
        if (config.worktree.useProjectSubfolder) {
          const projectName = path.basename(gitRoot)
          worktreePath = path.join(config.worktree.defaultPath, projectName, sanitizedBranch)
        } else {
          worktreePath = path.join(config.worktree.defaultPath, sanitizedBranch)
        }
      } else {
        return {
          resolvedPath: null,
          error: 'Path is required. Provide --path flag or set worktree.defaultPath in config.',
        }
      }

      // Resolve relative to git root if not absolute
      const resolved = path.isAbsolute(worktreePath)
        ? worktreePath
        : path.resolve(gitRoot, worktreePath)

      return { resolvedPath: resolved, error: null }
    }

    it('should resolve path using defaultPath + branch when --path not provided', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      const result = resolveWorktreePath(
        { branch: 'feature-x' }, // No --path
        config,
        gitRoot
      )

      expect(result.error).toBeNull()
      expect(result.resolvedPath).toContain('worktrees')
      expect(result.resolvedPath).toContain('feature-x')
    })

    it('should error when no --path and no defaultPath in config', async () => {
      // No .pando.toml or empty config
      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      const result = resolveWorktreePath(
        { branch: 'feature-x' }, // No --path
        config,
        gitRoot
      )

      expect(result.error).toBe(
        'Path is required. Provide --path flag or set worktree.defaultPath in config.'
      )
      expect(result.resolvedPath).toBeNull()
    })

    it('should use --path flag over defaultPath', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      const result = resolveWorktreePath(
        { path: '../custom-path', branch: 'feature-x' }, // --path provided
        config,
        gitRoot
      )

      expect(result.error).toBeNull()
      expect(result.resolvedPath).toContain('custom-path')
      expect(result.resolvedPath).not.toContain('worktrees')
    })

    it('should include project subfolder when useProjectSubfolder=true', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
useProjectSubfolder = true
`
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })
      const projectName = path.basename(gitRoot)

      const result = resolveWorktreePath({ branch: 'feature-x' }, config, gitRoot)

      expect(result.error).toBeNull()
      expect(result.resolvedPath).toContain(projectName)
      expect(result.resolvedPath).toContain('feature-x')
    })

    it('should sanitize branch names with slashes', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../worktrees"
`
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      const result = resolveWorktreePath({ branch: 'feature/login/oauth' }, config, gitRoot)

      expect(result.error).toBeNull()
      expect(result.resolvedPath).toContain('feature_login_oauth')
      // The branch name slashes should be converted to underscores
      // (the path still contains / for directory separators which is expected)
      const basename = path.basename(result.resolvedPath!)
      expect(basename).toBe('feature_login_oauth')
      expect(basename).not.toContain('/')
    })
  })

  describe('Config Priority with Multiple Sources', () => {
    it('should prioritize .pando.toml over package.json', async () => {
      // Create .pando.toml
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../pando-worktrees"
`
      )

      // Create package.json with pando config
      await fs.writeFile(
        path.join(gitRoot, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          pando: {
            worktree: {
              defaultPath: '../pkg-worktrees',
            },
          },
        })
      )

      const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

      // .pando.toml has higher priority (80) than package.json (68)
      expect(config.worktree.defaultPath).toBe('../pando-worktrees')
    })

    it('should prioritize env var over .pando.toml', async () => {
      const originalEnv = process.env

      try {
        process.env = {
          ...originalEnv,
          PANDO_WORKTREE_DEFAULT_PATH: '../env-worktrees',
        }

        await fs.writeFile(
          path.join(gitRoot, '.pando.toml'),
          `
[worktree]
defaultPath = "../file-worktrees"
`
        )

        const config = await loadConfig({ cwd: gitRoot, gitRoot, skipCache: true })

        // Env vars have higher priority (90) than .pando.toml (80)
        expect(config.worktree.defaultPath).toBe('../env-worktrees')
      } finally {
        process.env = originalEnv
      }
    })
  })

  describe('Cache Behavior', () => {
    it('should return cached config by default', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../original-path"
`
      )

      const config1 = await loader.load({ cwd: gitRoot, gitRoot })

      // Modify config file
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../modified-path"
`
      )

      // Should still return cached value
      const config2 = await loader.load({ cwd: gitRoot, gitRoot })

      expect(config1.worktree.defaultPath).toBe('../original-path')
      expect(config2.worktree.defaultPath).toBe('../original-path')
      expect(config1).toBe(config2) // Same object reference
    })

    it('should reload config when skipCache=true', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../original-path"
`
      )

      const config1 = await loader.load({ cwd: gitRoot, gitRoot })

      // Modify config file
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../modified-path"
`
      )

      // Should return new value with skipCache
      const config2 = await loader.load({ cwd: gitRoot, gitRoot, skipCache: true })

      expect(config1.worktree.defaultPath).toBe('../original-path')
      expect(config2.worktree.defaultPath).toBe('../modified-path')
    })

    it('should reload after clearCache', async () => {
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../original-path"
`
      )

      const config1 = await loader.load({ cwd: gitRoot, gitRoot })

      // Modify config file
      await fs.writeFile(
        path.join(gitRoot, '.pando.toml'),
        `
[worktree]
defaultPath = "../modified-path"
`
      )

      // Clear cache
      loader.clearCache()

      // Should return new value after cache clear
      const config2 = await loader.load({ cwd: gitRoot, gitRoot })

      expect(config1.worktree.defaultPath).toBe('../original-path')
      expect(config2.worktree.defaultPath).toBe('../modified-path')
    })
  })
})
