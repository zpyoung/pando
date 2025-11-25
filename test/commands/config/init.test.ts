import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import simpleGit from 'simple-git'
import { parse as parseToml } from '@iarna/toml'
import ConfigInit from '../../../src/commands/config/init.js'

describe('config init', () => {
  let tempDir: string
  let originalCwd: string
  let command: ConfigInit
  let logSpy: ReturnType<typeof vi.spyOn>
  let _errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    // Save original working directory
    originalCwd = process.cwd()

    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-test-'))

    // Change to temp directory
    process.chdir(tempDir)

    // Initialize git repository in temp directory
    const git = simpleGit(tempDir)
    await git.init()
    await git.addConfig('user.name', 'Test User')
    await git.addConfig('user.email', 'test@example.com')

    // Create command instance
    command = new ConfigInit([], {} as any)

    // Spy on log and error methods
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
    _errorSpy = vi.spyOn(command, 'error').mockImplementation((...args: unknown[]) => {
      throw new Error(String(args[0]))
    })
  })

  afterEach(async () => {
    // Restore original working directory
    process.chdir(originalCwd)

    // Clean up temp directory
    await fs.remove(tempDir)

    // Restore all mocks
    vi.restoreAllMocks()
  })

  describe('basic functionality', () => {
    it('should create .pando.toml in current directory', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      // Check file was created
      const configPath = path.join(tempDir, '.pando.toml')
      expect(await fs.pathExists(configPath)).toBe(true)
    })

    it('should create valid TOML content with defaults', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      const configPath = path.join(tempDir, '.pando.toml')
      const content = await fs.readFile(configPath, 'utf-8')

      // Parse TOML to verify it's valid
      const config = parseToml(content) as Record<string, unknown>

      // Check structure
      expect(config).toHaveProperty('rsync')
      expect(config).toHaveProperty('symlink')
      expect(config).toHaveProperty('worktree')

      // Check rsync defaults
      const rsync = config.rsync as Record<string, unknown>
      expect(rsync.enabled).toBe(true)
      expect(rsync.flags).toEqual(['--archive', '--exclude', '.git'])
      expect(rsync.exclude).toEqual([])

      // Check symlink defaults
      const symlink = config.symlink as Record<string, unknown>
      expect(symlink.patterns).toEqual([])
      expect(symlink.relative).toBe(true)
      expect(symlink.beforeRsync).toBe(true)

      // Check worktree defaults
      const worktree = config.worktree as Record<string, unknown>
      expect(worktree.rebaseOnAdd).toBe(true)
      expect(worktree.deleteBranchOnRemove).toBe('none')
    })

    it('should include helpful comments in output', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      const configPath = path.join(tempDir, '.pando.toml')
      const content = await fs.readFile(configPath, 'utf-8')

      // Check for header comment
      expect(content).toContain('# Pando Configuration')
      expect(content).toContain('# This file configures pando')

      // Check for section comments
      expect(content).toContain('# Rsync Configuration')
      expect(content).toContain('# Symlink Configuration')
      expect(content).toContain('# Patterns support glob syntax')
      expect(content).toContain('# Worktree Configuration')
    })

    it('should output JSON when --json flag is used', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"status": "success"'))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"action": "created"'))
    })
  })

  describe('--force flag', () => {
    it('should fail if file exists with --no-merge', async () => {
      // Create initial config
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)
      await command.run()

      // Reset spies
      vi.clearAllMocks()

      // Try to create again with --no-merge
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: false },
        args: {},
      } as any)
      _errorSpy = vi.spyOn(command, 'error').mockImplementation((...args: unknown[]) => {
        throw new Error(String(args[0]))
      })

      await expect(command.run()).rejects.toThrow('already exists')
    })

    it('should overwrite existing file with --force', async () => {
      const configPath = path.join(tempDir, '.pando.toml')

      // Create initial config
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)
      await command.run()

      // Modify the file
      await fs.writeFile(configPath, '# Modified content\n[rsync]\nenabled = false\n')

      // Reset mocks
      vi.clearAllMocks()

      // Overwrite with --force
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: true, merge: true },
        args: {},
      } as any)
      logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})

      await command.run()

      // Verify file was overwritten with fresh content
      const content = await fs.readFile(configPath, 'utf-8')
      expect(content).toContain('# Pando Configuration')
      expect(content).not.toContain('# Modified content')

      // Check that rsync.enabled is back to default
      const config = parseToml(content) as Record<string, any>
      expect(config.rsync.enabled).toBe(true)
    })
  })

  describe('merge behavior', () => {
    it('should merge missing defaults into existing config by default', async () => {
      const configPath = path.join(tempDir, '.pando.toml')

      // Create partial config
      await fs.writeFile(
        configPath,
        `[rsync]
enabled = false

[symlink]
patterns = ["node_modules"]
`
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      // Check JSON output
      const logCalls = logSpy.mock.calls
      const jsonOutput = logCalls[0]?.[0] as string
      const result = JSON.parse(jsonOutput)

      expect(result.status).toBe('success')
      expect(result.action).toBe('merged')
      expect(result.added).toBeInstanceOf(Array)
      expect(result.addedCount).toBeGreaterThan(0)

      // Verify file has merged content
      const content = await fs.readFile(configPath, 'utf-8')
      const config = parseToml(content) as Record<string, any>

      // User values preserved
      expect(config.rsync.enabled).toBe(false)
      expect(config.symlink.patterns).toEqual(['node_modules'])

      // Defaults added
      expect(config.rsync.flags).toEqual(['--archive', '--exclude', '.git'])
      expect(config.symlink.relative).toBe(true)
      expect(config.worktree).toBeDefined()
    })

    it('should report nothing added when config is complete', async () => {
      const _configPath = path.join(tempDir, '.pando.toml')

      // Create complete config first
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)
      await command.run()

      // Reset mocks
      vi.clearAllMocks()

      // Run again with JSON output
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)
      logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})

      await command.run()

      const logCalls = logSpy.mock.calls
      const jsonOutput = logCalls[0]?.[0] as string
      const result = JSON.parse(jsonOutput)

      expect(result.status).toBe('success')
      expect(result.action).toBe('unchanged')
      expect(result.added).toEqual([])
    })

    it('should track added settings correctly', async () => {
      const configPath = path.join(tempDir, '.pando.toml')

      // Create config with only rsync section, missing specific fields
      await fs.writeFile(
        configPath,
        `[rsync]
enabled = false
`
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const jsonOutput = logCalls[0]?.[0] as string
      const result = JSON.parse(jsonOutput)

      // Should have added rsync.flags, rsync.exclude, symlink, worktree
      const addedPaths = result.added.map((a: any) => a.path)
      expect(addedPaths).toContain('rsync.flags')
      expect(addedPaths).toContain('rsync.exclude')
      expect(addedPaths).toContain('symlink')
      expect(addedPaths).toContain('worktree')
    })
  })

  describe('--global flag', () => {
    it('should create config in ~/.config/pando/', async () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE
      if (!homeDir) {
        return // Skip test if home directory cannot be determined
      }

      const globalConfigDir = path.join(homeDir, '.config', 'pando')
      const globalConfigPath = path.join(globalConfigDir, 'config.toml')

      // Clean up any existing global config
      if (await fs.pathExists(globalConfigPath)) {
        await fs.remove(globalConfigPath)
      }

      try {
        vi.spyOn(command, 'parse').mockResolvedValue({
          flags: { json: false, global: true, 'git-root': false, force: false, merge: true },
          args: {},
        } as any)

        await command.run()

        // Check file was created in correct location
        expect(await fs.pathExists(globalConfigPath)).toBe(true)

        // Verify content is valid
        const content = await fs.readFile(globalConfigPath, 'utf-8')
        const config = parseToml(content)
        expect(config).toHaveProperty('rsync')
        expect(config).toHaveProperty('symlink')
      } finally {
        // Clean up global config
        if (await fs.pathExists(globalConfigPath)) {
          await fs.remove(globalConfigPath)
        }
      }
    })
  })

  describe('--git-root flag', () => {
    it('should create config at git repository root', async () => {
      // Create a subdirectory in the git repo
      const subDir = path.join(tempDir, 'sub', 'dir')
      await fs.ensureDir(subDir)
      process.chdir(subDir)

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': true, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      // Config should be at git root, not in subdirectory
      const configPath = path.join(tempDir, '.pando.toml')
      const wrongPath = path.join(subDir, '.pando.toml')

      expect(await fs.pathExists(configPath)).toBe(true)
      expect(await fs.pathExists(wrongPath)).toBe(false)
    })

    it('should fail if not in a git repository', async () => {
      // Create a directory outside git repo
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-test-nongit-'))

      try {
        process.chdir(nonGitDir)

        vi.spyOn(command, 'parse').mockResolvedValue({
          flags: { json: false, global: false, 'git-root': true, force: false, merge: true },
          args: {},
        } as any)
        _errorSpy = vi.spyOn(command, 'error').mockImplementation((...args: unknown[]) => {
          throw new Error(String(args[0]))
        })

        await expect(command.run()).rejects.toThrow('Not in a git repository')
      } finally {
        process.chdir(tempDir)
        await fs.remove(nonGitDir)
      }
    })
  })

  describe('file permissions', () => {
    it('should create file with 0o644 permissions', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      const configPath = path.join(tempDir, '.pando.toml')
      const stats = await fs.stat(configPath)

      // Check permissions (only on Unix-like systems)
      if (process.platform !== 'win32') {
        const mode = stats.mode & 0o777
        expect(mode).toBe(0o644)
      }
    })
  })

  describe('error handling', () => {
    it('should handle missing home directory gracefully', async () => {
      // Save original HOME
      const originalHome = process.env.HOME
      const originalUserProfile = process.env.USERPROFILE

      try {
        // Remove HOME environment variables
        delete process.env.HOME
        delete process.env.USERPROFILE

        vi.spyOn(command, 'parse').mockResolvedValue({
          flags: { json: false, global: true, 'git-root': false, force: false, merge: true },
          args: {},
        } as any)
        _errorSpy = vi.spyOn(command, 'error').mockImplementation((...args: unknown[]) => {
          throw new Error(String(args[0]))
        })

        await expect(command.run()).rejects.toThrow('Could not determine home directory')
      } finally {
        // Restore HOME
        if (originalHome) process.env.HOME = originalHome
        if (originalUserProfile) process.env.USERPROFILE = originalUserProfile
      }
    })
  })

  describe('directory creation', () => {
    it('should create parent directories if they do not exist', async () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE
      if (!homeDir) {
        return // Skip if home directory cannot be determined
      }

      const globalConfigDir = path.join(homeDir, '.config', 'pando')

      // Remove .config/pando directory if it exists
      if (await fs.pathExists(globalConfigDir)) {
        await fs.remove(globalConfigDir)
      }

      try {
        vi.spyOn(command, 'parse').mockResolvedValue({
          flags: { json: false, global: true, 'git-root': false, force: false, merge: true },
          args: {},
        } as any)

        await command.run()

        // Verify directory was created
        expect(await fs.pathExists(globalConfigDir)).toBe(true)

        // Verify config file exists
        const globalConfigPath = path.join(globalConfigDir, 'config.toml')
        expect(await fs.pathExists(globalConfigPath)).toBe(true)
      } finally {
        // Clean up
        if (await fs.pathExists(globalConfigDir)) {
          await fs.remove(globalConfigDir)
        }
      }
    })
  })

  describe('output messages', () => {
    it('should show next steps after creation', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      // Verify output contains next steps
      const calls = logSpy.mock.calls
      const outputs = calls.map((call: any) => call[0]).join('\n')
      expect(outputs).toContain('Next steps')
      expect(outputs).toContain('pando config show')
    })

    it('should show merge message when merging', async () => {
      const configPath = path.join(tempDir, '.pando.toml')

      // Create partial config
      await fs.writeFile(configPath, '[rsync]\nenabled = false\n')

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, global: false, 'git-root': false, force: false, merge: true },
        args: {},
      } as any)

      await command.run()

      const calls = logSpy.mock.calls
      const outputs = calls.map((call: any) => call[0]).join('\n')
      expect(outputs).toContain('Configuration updated')
      expect(outputs).toContain('missing setting')
    })
  })
})
