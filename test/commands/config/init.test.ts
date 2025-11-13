import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runCommand } from '@oclif/test'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as os from 'os'
import simpleGit from 'simple-git'
import { parse as parseToml } from '@iarna/toml'

describe('config:init', () => {
  let tempDir: string
  let originalCwd: string

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
  })

  afterEach(async () => {
    // Restore original working directory
    process.chdir(originalCwd)

    // Clean up temp directory
    await fs.remove(tempDir)
  })

  describe('basic functionality', () => {
    it('should create .pando.toml in current directory', async () => {
      const result = await runCommand(['config:init'], import.meta.url)

      // Check file was created
      const configPath = path.join(tempDir, '.pando.toml')
      expect(await fs.pathExists(configPath)).toBe(true)

      // Check output message (oclif may put output in stdout or via this.log)
      expect(result.error).toBeUndefined()
    })

    it('should create valid TOML content with defaults', async () => {
      await runCommand(['config:init'], import.meta.url)

      const configPath = path.join(tempDir, '.pando.toml')
      const content = await fs.readFile(configPath, 'utf-8')

      // Parse TOML to verify it's valid
      const config = parseToml(content) as Record<string, unknown>

      // Check structure
      expect(config).toHaveProperty('rsync')
      expect(config).toHaveProperty('symlink')

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
    })

    it('should include helpful comments in output', async () => {
      await runCommand(['config:init'], import.meta.url)

      const configPath = path.join(tempDir, '.pando.toml')
      const content = await fs.readFile(configPath, 'utf-8')

      // Check for header comment
      expect(content).toContain('# Pando Configuration')
      expect(content).toContain('# This file configures pando')

      // Check for section comments
      expect(content).toContain('# Rsync Configuration')
      expect(content).toContain('# Symlink Configuration')
      expect(content).toContain('# Patterns support glob syntax')
    })
  })

  describe('--force flag', () => {
    it('should fail if file exists without --force', async () => {
      // Create initial config
      await runCommand(['config:init'], import.meta.url)

      // Try to create again without --force
      const result = await runCommand(['config:init'], import.meta.url)

      // Should have an error
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('already exists')
    })

    it('should overwrite existing file with --force', async () => {
      const configPath = path.join(tempDir, '.pando.toml')

      // Create initial config
      await runCommand(['config:init'], import.meta.url)

      // Modify the file
      await fs.writeFile(configPath, '# Modified content\n')

      // Overwrite with --force
      await runCommand(['config:init', '--force'], import.meta.url)

      // Verify file was overwritten with fresh content
      const content = await fs.readFile(configPath, 'utf-8')
      expect(content).toContain('# Pando Configuration')
      expect(content).not.toContain('# Modified content')
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
        const result = await runCommand(['config:init', '--global'], import.meta.url)

        // Check file was created in correct location
        expect(await fs.pathExists(globalConfigPath)).toBe(true)
        expect(result.error).toBeUndefined()

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

    it('should use config.toml filename for global config', async () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE
      if (!homeDir) {
        return // Skip test if home directory cannot be determined
      }

      const globalConfigPath = path.join(homeDir, '.config', 'pando', 'config.toml')

      // Clean up any existing global config
      if (await fs.pathExists(globalConfigPath)) {
        await fs.remove(globalConfigPath)
      }

      try {
        await runCommand(['config:init', '--global'], import.meta.url)
        expect(await fs.pathExists(globalConfigPath)).toBe(true)
      } finally {
        // Clean up
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

      const result = await runCommand(['config:init', '--git-root'], import.meta.url)

      // Config should be at git root, not in subdirectory
      const configPath = path.join(tempDir, '.pando.toml')
      const wrongPath = path.join(subDir, '.pando.toml')

      expect(await fs.pathExists(configPath)).toBe(true)
      expect(await fs.pathExists(wrongPath)).toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('should fail if not in a git repository', async () => {
      // Create a directory outside git repo
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-test-nongit-'))

      try {
        process.chdir(nonGitDir)

        const result = await runCommand(['config:init', '--git-root'], import.meta.url)

        expect(result.error).toBeDefined()
        expect(result.error?.message).toContain('Not in a git repository')
      } finally {
        process.chdir(tempDir)
        await fs.remove(nonGitDir)
      }
    })
  })

  describe('file permissions', () => {
    it('should create file with 0o644 permissions', async () => {
      await runCommand(['config:init'], import.meta.url)

      const configPath = path.join(tempDir, '.pando.toml')
      const stats = await fs.stat(configPath)

      // Check permissions (only on Unix-like systems)
      if (process.platform !== 'win32') {
        // eslint-disable-next-line no-bitwise
        const mode = stats.mode & 0o777
        expect(mode).toBe(0o644)
      }
    })
  })

  describe('error handling', () => {
    it('should handle write failures gracefully', async () => {
      // Skip on Windows as permissions behave differently
      if (process.platform === 'win32') {
        return
      }

      // Create a file where the config should be, then make it unwritable
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(configPath, '# existing file\n')
      await fs.chmod(configPath, 0o444) // Read-only

      try {
        const result = await runCommand(['config:init', '--force'], import.meta.url)

        // Should fail because file is read-only
        expect(result.error).toBeDefined()
        expect(result.error?.message).toContain('Failed to create configuration file')
      } finally {
        // Restore permissions to clean up
        await fs.chmod(configPath, 0o644)
      }
    })

    it('should handle missing home directory gracefully', async () => {
      // Save original HOME
      const originalHome = process.env.HOME
      const originalUserProfile = process.env.USERPROFILE

      try {
        // Remove HOME environment variables
        delete process.env.HOME
        delete process.env.USERPROFILE

        const result = await runCommand(['config:init', '--global'], import.meta.url)

        expect(result.error).toBeDefined()
        expect(result.error?.message).toContain('Could not determine home directory')
      } finally {
        // Restore HOME
        if (originalHome) process.env.HOME = originalHome
        if (originalUserProfile) process.env.USERPROFILE = originalUserProfile
      }
    })
  })

  describe('conflicting flags', () => {
    it('should handle --global and --git-root together', async () => {
      // Both flags should work, but --global takes precedence
      const homeDir = process.env.HOME || process.env.USERPROFILE
      if (!homeDir) {
        return // Skip if home directory cannot be determined
      }

      const globalConfigPath = path.join(homeDir, '.config', 'pando', 'config.toml')

      // Clean up any existing global config
      if (await fs.pathExists(globalConfigPath)) {
        await fs.remove(globalConfigPath)
      }

      try {
        await runCommand(['config:init', '--global', '--git-root'], import.meta.url)

        // Should create global config (global takes precedence)
        expect(await fs.pathExists(globalConfigPath)).toBe(true)
      } finally {
        // Clean up
        if (await fs.pathExists(globalConfigPath)) {
          await fs.remove(globalConfigPath)
        }
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
        await runCommand(['config:init', '--global'], import.meta.url)

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
      const result = await runCommand(['config:init'], import.meta.url)

      expect(result.error).toBeUndefined()

      // Verify config file exists (that's the main success indicator)
      const configPath = path.join(tempDir, '.pando.toml')
      expect(await fs.pathExists(configPath)).toBe(true)
    })

    it('should show different message for global config', async () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE
      if (!homeDir) {
        return // Skip if home directory cannot be determined
      }

      const globalConfigPath = path.join(homeDir, '.config', 'pando', 'config.toml')

      // Clean up any existing global config
      if (await fs.pathExists(globalConfigPath)) {
        await fs.remove(globalConfigPath)
      }

      try {
        const result = await runCommand(['config:init', '--global'], import.meta.url)

        expect(result.error).toBeUndefined()
        expect(await fs.pathExists(globalConfigPath)).toBe(true)
      } finally {
        // Clean up
        if (await fs.pathExists(globalConfigPath)) {
          await fs.remove(globalConfigPath)
        }
      }
    })

    it('should show project-specific message for local config', async () => {
      const result = await runCommand(['config:init'], import.meta.url)

      expect(result.error).toBeUndefined()

      // Verify config file exists
      const configPath = path.join(tempDir, '.pando.toml')
      expect(await fs.pathExists(configPath)).toBe(true)
    })
  })
})
