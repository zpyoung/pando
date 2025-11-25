import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'path'
import * as fs from 'fs-extra'
import * as os from 'os'
import simpleGit from 'simple-git'
import ConfigShow from '../../../src/commands/config/show.js'

describe('config show', () => {
  let tempDir: string
  let originalCwd: string
  let command: ConfigShow
  let logSpy: ReturnType<typeof vi.spyOn>

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
    command = new ConfigShow([], {} as any)

    // Spy on log method
    logSpy = vi.spyOn(command, 'log').mockImplementation(() => {})
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
    it('runs without errors', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, sources: false },
        args: {},
      } as any)

      await command.run()

      // Should have called log at least once
      expect(logSpy).toHaveBeenCalled()
    })

    it('runs with --sources flag without errors', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, sources: true },
        args: {},
      } as any)

      await command.run()

      expect(logSpy).toHaveBeenCalled()
    })

    it('runs with --json flag without errors', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: false },
        args: {},
      } as any)

      await command.run()

      // Should output valid JSON
      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)
      expect(parsed).toHaveProperty('rsync')
      expect(parsed).toHaveProperty('symlink')
    })

    it('runs with combined flags without errors', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: true },
        args: {},
      } as any)

      await command.run()

      // Should output valid JSON with sources
      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)
      expect(parsed).toHaveProperty('config')
      expect(parsed).toHaveProperty('sources')
    })
  })

  describe('configuration from .pando.toml', () => {
    it('loads custom config from .pando.toml', async () => {
      // Create .pando.toml with custom config
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[rsync]
enabled = false
exclude = ["*.log", "tmp/"]

[symlink]
patterns = ["package.json", "pnpm-lock.yaml"]
`
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: false },
        args: {},
      } as any)

      await command.run()

      // Verify custom values are loaded
      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)
      expect(parsed.rsync.enabled).toBe(false)
      expect(parsed.rsync.exclude).toEqual(['*.log', 'tmp/'])
      expect(parsed.symlink.patterns).toEqual(['package.json', 'pnpm-lock.yaml'])
    })

    it('shows custom values in JSON output', async () => {
      // Create .pando.toml with custom config
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[rsync]
enabled = false
exclude = ["*.log", "tmp/"]

[symlink]
patterns = ["package.json", "pnpm-lock.yaml"]
`
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: true },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)

      // Check that sources are tracked
      expect(parsed.sources['rsync.enabled']).toBe('pando_toml')
      expect(parsed.sources['symlink.patterns']).toBe('pando_toml')
    })
  })

  describe('configuration from package.json', () => {
    it('loads custom config from package.json', async () => {
      // Create package.json with pando config
      const packageJsonPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          pando: {
            symlink: {
              patterns: ['package.json', 'package-lock.json'],
            },
          },
        })
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: false },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)
      expect(parsed.symlink.patterns).toEqual(['package.json', 'package-lock.json'])
    })

    it('shows package.json values in JSON output', async () => {
      // Create package.json with pando config
      const packageJsonPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          pando: {
            symlink: {
              patterns: ['package.json', 'package-lock.json'],
            },
          },
        })
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: true },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)
      expect(parsed.sources['symlink.patterns']).toBe('package_json')
    })
  })

  describe('configuration merging', () => {
    it('merges multiple config sources correctly', async () => {
      // Create both .pando.toml and package.json
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[rsync]
enabled = false
`
      )

      const packageJsonPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          pando: {
            symlink: {
              patterns: ['package.json'],
            },
          },
        })
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: false },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)

      // pando.toml has higher priority, but both should contribute
      expect(parsed.rsync.enabled).toBe(false) // from .pando.toml
      expect(parsed.symlink.patterns).toEqual(['package.json']) // from package.json
    })

    it('shows multiple sources when using --sources flag', async () => {
      // Create both .pando.toml and package.json
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[rsync]
enabled = false
`
      )

      const packageJsonPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          pando: {
            symlink: {
              patterns: ['package.json'],
            },
          },
        })
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: true },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)

      expect(parsed.sources['rsync.enabled']).toBe('pando_toml')
      expect(parsed.sources['symlink.patterns']).toBe('package_json')
    })
  })

  describe('empty configuration', () => {
    it('handles empty config with defaults only', async () => {
      // No config files created, should use defaults
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: false },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)

      // Should have default values
      expect(parsed.rsync.enabled).toBe(true)
      expect(parsed.rsync.flags).toEqual(['--archive', '--exclude', '.git'])
      expect(parsed.symlink.patterns).toEqual([])
      expect(parsed.symlink.relative).toBe(true)
    })

    it('outputs valid defaults in JSON format', async () => {
      // No config files created, should use defaults
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: true },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)

      // All sources should be 'default'
      expect(parsed.sources['rsync.enabled']).toBe('default')
      expect(parsed.sources['symlink.patterns']).toBe('default')
    })
  })

  describe('error handling', () => {
    it('does not throw errors for valid configuration', async () => {
      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: false, sources: false },
        args: {},
      } as any)

      await expect(command.run()).resolves.not.toThrow()
    })

    it('handles non-git directories gracefully', async () => {
      // Create a new non-git directory
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-non-git-'))

      try {
        process.chdir(nonGitDir)

        vi.spyOn(command, 'parse').mockResolvedValue({
          flags: { json: true, sources: false },
          args: {},
        } as any)

        // Should still work (falls back to cwd)
        await expect(command.run()).resolves.not.toThrow()
      } finally {
        // Restore
        process.chdir(tempDir)
        await fs.remove(nonGitDir)
      }
    })
  })

  describe('integration with ConfigLoader', () => {
    it('successfully loads and displays configuration', async () => {
      // Create a complete configuration
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
# Pando Configuration

[rsync]
enabled = true
flags = ["--archive", "--verbose", "--exclude", ".git"]
exclude = ["*.log", "tmp/", "node_modules/"]

[symlink]
patterns = ["package.json", "pnpm-lock.yaml", ".env*"]
relative = true
beforeRsync = true
`
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: false },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)

      expect(parsed.rsync.enabled).toBe(true)
      expect(parsed.rsync.exclude).toEqual(['*.log', 'tmp/', 'node_modules/'])
      expect(parsed.symlink.patterns).toEqual(['package.json', 'pnpm-lock.yaml', '.env*'])
    })

    it('successfully loads configuration with sources', async () => {
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[rsync]
enabled = false
`
      )

      vi.spyOn(command, 'parse').mockResolvedValue({
        flags: { json: true, sources: true },
        args: {},
      } as any)

      await command.run()

      const logCalls = logSpy.mock.calls
      const output = logCalls[0]?.[0] as string
      const parsed = JSON.parse(output)

      expect(parsed.config.rsync.enabled).toBe(false)
      expect(parsed.sources['rsync.enabled']).toBe('pando_toml')
    })
  })
})
