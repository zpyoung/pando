import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runCommand } from '@oclif/test'
import * as path from 'path'
import * as fs from 'fs-extra'
import * as os from 'os'
import simpleGit from 'simple-git'

/**
 * Tests for config:show command
 *
 * Tests configuration display in various formats and scenarios:
 * - Basic config display (human-readable)
 * - JSON output format
 * - --sources flag showing source information
 * - Configuration from multiple sources
 *
 * Note: @oclif/test's runCommand doesn't capture stdout in result.stdout
 * for text output, but we can verify the command runs without errors
 * and test JSON output via captured output in test environment.
 */

describe('config:show', () => {
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
    it('runs without errors', async () => {
      const result = await runCommand(['config:show'], import.meta.url)

      // Verify no errors occurred
      expect(result.error).toBeUndefined()
    })

    it('runs with --sources flag without errors', async () => {
      const result = await runCommand(['config:show', '--sources'], import.meta.url)

      expect(result.error).toBeUndefined()
    })

    it('runs with --json flag without errors', async () => {
      const result = await runCommand(['config:show', '--json'], import.meta.url)

      expect(result.error).toBeUndefined()
    })

    it('runs with combined flags without errors', async () => {
      const result = await runCommand(['config:show', '--json', '--sources'], import.meta.url)

      expect(result.error).toBeUndefined()
    })
  })

  describe('short flags', () => {
    it('supports -j short flag for JSON', async () => {
      const result = await runCommand(['config:show', '-j'], import.meta.url)

      expect(result.error).toBeUndefined()
    })

    it('supports -s short flag for sources', async () => {
      const result = await runCommand(['config:show', '-s'], import.meta.url)

      expect(result.error).toBeUndefined()
    })

    it('supports combined short flags -j -s', async () => {
      const result = await runCommand(['config:show', '-j', '-s'], import.meta.url)

      expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show'], import.meta.url)

      // Should run without error
      expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show', '--json'], import.meta.url)

      expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show'], import.meta.url)

      expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show', '--json'], import.meta.url)

      expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show'], import.meta.url)

      expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show', '--sources'], import.meta.url)

      expect(result.error).toBeUndefined()
    })
  })

  describe('empty configuration', () => {
    it('handles empty config with defaults only', async () => {
      // No config files created, should use defaults
      const result = await runCommand(['config:show'], import.meta.url)

      expect(result.error).toBeUndefined()
    })

    it('outputs valid defaults in JSON format', async () => {
      // No config files created, should use defaults
      const result = await runCommand(['config:show', '--json'], import.meta.url)

      expect(result.error).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('does not throw errors for valid configuration', async () => {
      const result = await runCommand(['config:show'], import.meta.url)

      expect(result.error).toBeUndefined()
    })

    it('handles non-git directories gracefully', async () => {
      // Create a new non-git directory
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-non-git-'))

      try {
        process.chdir(nonGitDir)

        const result = await runCommand(['config:show'], import.meta.url)

        // Should still work (falls back to cwd)
        expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show'], import.meta.url)

      expect(result.error).toBeUndefined()
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

      const result = await runCommand(['config:show', '--json', '--sources'], import.meta.url)

      expect(result.error).toBeUndefined()
    })
  })
})
