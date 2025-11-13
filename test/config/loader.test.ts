import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import {
  configFileExists,
  discoverConfigFiles,
  getGlobalConfigPath,
  mergeConfigs,
  mergeMultipleConfigs,
  parseCargoToml,
  parseComposerJson,
  parseConfigFile,
  parseDenoJson,
  parsePackageJson,
  parsePandoToml,
  parsePyprojectToml,
  ConfigLoader,
} from '../../src/config/loader'
import { ConfigSource, DEFAULT_CONFIG } from '../../src/config/schema'
import type { PartialPandoConfig } from '../../src/config/schema'

describe('Config Loader', () => {
  let tempDir: string

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pando-test-'))
  })

  afterEach(async () => {
    // Clean up temporary directory
    await fs.remove(tempDir)
  })

  // ============================================================================
  // File Existence Tests
  // ============================================================================

  describe('configFileExists', () => {
    it('should return true for existing file', async () => {
      const testFile = path.join(tempDir, 'test.txt')
      await fs.writeFile(testFile, 'test')

      const exists = await configFileExists(testFile)
      expect(exists).toBe(true)
    })

    it('should return false for non-existing file', async () => {
      const testFile = path.join(tempDir, 'nonexistent.txt')

      const exists = await configFileExists(testFile)
      expect(exists).toBe(false)
    })
  })

  describe('getGlobalConfigPath', () => {
    it('should return correct global config path', () => {
      const expected = path.join(os.homedir(), '.config', 'pando', 'config.toml')
      const actual = getGlobalConfigPath()

      expect(actual).toBe(expected)
    })
  })

  // ============================================================================
  // Parser Tests
  // ============================================================================

  describe('parsePandoToml', () => {
    it('should parse valid .pando.toml file', async () => {
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[rsync]
enabled = true
flags = ["--archive", "--verbose"]
exclude = ["*.log"]

[symlink]
patterns = ["package.json"]
relative = true
beforeRsync = true
`
      )

      const config = await parsePandoToml(configPath)

      expect(config).toEqual({
        rsync: {
          enabled: true,
          flags: ['--archive', '--verbose'],
          exclude: ['*.log'],
        },
        symlink: {
          patterns: ['package.json'],
          relative: true,
          beforeRsync: true,
        },
      })
    })

    it('should parse partial configuration', async () => {
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        configPath,
        `
[rsync]
enabled = false
`
      )

      const config = await parsePandoToml(configPath)

      expect(config).toEqual({
        rsync: {
          enabled: false,
        },
      })
    })

    it('should parse empty file as empty config', async () => {
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(configPath, '')

      const config = await parsePandoToml(configPath)

      expect(config).toEqual({})
    })
  })

  describe('parsePyprojectToml', () => {
    it('should parse [tool.pando] section', async () => {
      const configPath = path.join(tempDir, 'pyproject.toml')
      await fs.writeFile(
        configPath,
        `
[tool.poetry]
name = "my-project"

[tool.pando]
[tool.pando.rsync]
enabled = true
flags = ["--archive"]

[tool.pando.symlink]
patterns = ["poetry.lock"]
`
      )

      const config = await parsePyprojectToml(configPath)

      expect(config).toEqual({
        rsync: {
          enabled: true,
          flags: ['--archive'],
        },
        symlink: {
          patterns: ['poetry.lock'],
        },
      })
    })

    it('should return empty config if no [tool.pando] section', async () => {
      const configPath = path.join(tempDir, 'pyproject.toml')
      await fs.writeFile(
        configPath,
        `
[tool.poetry]
name = "my-project"
`
      )

      const config = await parsePyprojectToml(configPath)

      expect(config).toEqual({})
    })
  })

  describe('parseCargoToml', () => {
    it('should parse [package.metadata.pando] section', async () => {
      const configPath = path.join(tempDir, 'Cargo.toml')
      await fs.writeFile(
        configPath,
        `
[package]
name = "my-crate"
version = "0.1.0"

[package.metadata.pando]
[package.metadata.pando.rsync]
enabled = false

[package.metadata.pando.symlink]
patterns = ["Cargo.lock"]
`
      )

      const config = await parseCargoToml(configPath)

      expect(config).toEqual({
        rsync: {
          enabled: false,
        },
        symlink: {
          patterns: ['Cargo.lock'],
        },
      })
    })

    it('should return empty config if no [package.metadata.pando] section', async () => {
      const configPath = path.join(tempDir, 'Cargo.toml')
      await fs.writeFile(
        configPath,
        `
[package]
name = "my-crate"
version = "0.1.0"
`
      )

      const config = await parseCargoToml(configPath)

      expect(config).toEqual({})
    })
  })

  describe('parsePackageJson', () => {
    it('should parse "pando" key', async () => {
      const configPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          name: 'my-package',
          version: '1.0.0',
          pando: {
            rsync: {
              enabled: true,
              flags: ['--archive', '--delete'],
            },
            symlink: {
              patterns: ['package-lock.json', 'pnpm-lock.yaml'],
            },
          },
        })
      )

      const config = await parsePackageJson(configPath)

      expect(config).toEqual({
        rsync: {
          enabled: true,
          flags: ['--archive', '--delete'],
        },
        symlink: {
          patterns: ['package-lock.json', 'pnpm-lock.yaml'],
        },
      })
    })

    it('should return empty config if no "pando" key', async () => {
      const configPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          name: 'my-package',
          version: '1.0.0',
        })
      )

      const config = await parsePackageJson(configPath)

      expect(config).toEqual({})
    })
  })

  describe('parseDenoJson', () => {
    it('should parse "pando" key', async () => {
      const configPath = path.join(tempDir, 'deno.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          compilerOptions: {
            lib: ['deno.window'],
          },
          pando: {
            rsync: {
              enabled: true,
            },
            symlink: {
              patterns: ['deno.lock'],
            },
          },
        })
      )

      const config = await parseDenoJson(configPath)

      expect(config).toEqual({
        rsync: {
          enabled: true,
        },
        symlink: {
          patterns: ['deno.lock'],
        },
      })
    })

    it('should return empty config if no "pando" key', async () => {
      const configPath = path.join(tempDir, 'deno.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          compilerOptions: {
            lib: ['deno.window'],
          },
        })
      )

      const config = await parseDenoJson(configPath)

      expect(config).toEqual({})
    })
  })

  describe('parseComposerJson', () => {
    it('should parse "extra.pando" section', async () => {
      const configPath = path.join(tempDir, 'composer.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          name: 'vendor/package',
          require: {
            php: '^8.0',
          },
          extra: {
            pando: {
              rsync: {
                enabled: false,
              },
              symlink: {
                patterns: ['composer.lock'],
              },
            },
          },
        })
      )

      const config = await parseComposerJson(configPath)

      expect(config).toEqual({
        rsync: {
          enabled: false,
        },
        symlink: {
          patterns: ['composer.lock'],
        },
      })
    })

    it('should return empty config if no "extra.pando" section', async () => {
      const configPath = path.join(tempDir, 'composer.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          name: 'vendor/package',
          require: {
            php: '^8.0',
          },
        })
      )

      const config = await parseComposerJson(configPath)

      expect(config).toEqual({})
    })

    it('should return empty config if extra exists but no pando', async () => {
      const configPath = path.join(tempDir, 'composer.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          name: 'vendor/package',
          extra: {
            someOtherKey: 'value',
          },
        })
      )

      const config = await parseComposerJson(configPath)

      expect(config).toEqual({})
    })
  })

  describe('parseConfigFile', () => {
    it('should dispatch to correct parser based on source', async () => {
      // Test PANDO_TOML
      const pandoPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(
        pandoPath,
        `
[rsync]
enabled = false
`
      )

      const pandoConfig = await parseConfigFile({
        path: pandoPath,
        source: ConfigSource.PANDO_TOML,
        priority: 80,
        exists: true,
      })

      expect(pandoConfig).toEqual({
        rsync: {
          enabled: false,
        },
      })

      // Test PACKAGE_JSON
      const pkgPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        pkgPath,
        JSON.stringify({
          pando: {
            rsync: {
              enabled: true,
            },
          },
        })
      )

      const pkgConfig = await parseConfigFile({
        path: pkgPath,
        source: ConfigSource.PACKAGE_JSON,
        priority: 68,
        exists: true,
      })

      expect(pkgConfig).toEqual({
        rsync: {
          enabled: true,
        },
      })
    })

    it('should return empty config for unknown source', async () => {
      const config = await parseConfigFile({
        path: '/nonexistent',
        source: ConfigSource.CLI_FLAG,
        priority: 100,
        exists: false,
      })

      expect(config).toEqual({})
    })
  })

  // ============================================================================
  // Configuration Merging Tests
  // ============================================================================

  describe('mergeConfigs', () => {
    it('should merge two configs with override taking precedence', () => {
      const base: PartialPandoConfig = {
        rsync: {
          enabled: true,
          flags: ['--archive'],
        },
      }

      const override: PartialPandoConfig = {
        rsync: {
          enabled: false,
        },
      }

      const merged = mergeConfigs(base, override)

      expect(merged).toEqual({
        rsync: {
          enabled: false,
          flags: ['--archive'],
        },
      })
    })

    it('should replace arrays entirely', () => {
      const base: PartialPandoConfig = {
        rsync: {
          flags: ['--archive', '--verbose'],
          exclude: ['*.log'],
        },
      }

      const override: PartialPandoConfig = {
        rsync: {
          flags: ['--delete'],
        },
      }

      const merged = mergeConfigs(base, override)

      expect(merged.rsync?.flags).toEqual(['--delete'])
      expect(merged.rsync?.exclude).toEqual(['*.log'])
    })

    it('should handle nested objects', () => {
      const base: PartialPandoConfig = {
        rsync: {
          enabled: true,
        },
        symlink: {
          patterns: ['*.json'],
        },
      }

      const override: PartialPandoConfig = {
        rsync: {
          flags: ['--archive'],
        },
      }

      const merged = mergeConfigs(base, override)

      expect(merged).toEqual({
        rsync: {
          enabled: true,
          flags: ['--archive'],
        },
        symlink: {
          patterns: ['*.json'],
        },
      })
    })

    it('should ignore undefined values in override', () => {
      const base: PartialPandoConfig = {
        rsync: {
          enabled: true,
          flags: ['--archive'],
        },
      }

      const override: PartialPandoConfig = {
        rsync: {
          enabled: false,
        },
      }

      const merged = mergeConfigs(base, override)

      expect(merged.rsync?.flags).toEqual(['--archive'])
    })
  })

  describe('mergeMultipleConfigs', () => {
    it('should merge configs in priority order', () => {
      const configs = [
        {
          config: { rsync: { enabled: false } },
          source: ConfigSource.GLOBAL_CONFIG,
        },
        {
          config: { rsync: { enabled: true, flags: ['--archive'] } },
          source: ConfigSource.PANDO_TOML,
        },
        {
          config: { rsync: { flags: ['--delete'] } },
          source: ConfigSource.PACKAGE_JSON,
        },
      ]

      const result = mergeMultipleConfigs(configs)

      // PANDO_TOML has highest priority (80), so enabled=true wins
      // But flags from PANDO_TOML should be preserved since it has higher priority than PACKAGE_JSON
      expect(result.config.rsync.enabled).toBe(true)
      expect(result.config.rsync.flags).toEqual(['--archive'])
    })

    it('should track sources correctly', () => {
      const configs = [
        {
          config: { rsync: { enabled: false } },
          source: ConfigSource.GLOBAL_CONFIG,
        },
        {
          config: { rsync: { flags: ['--archive'] } },
          source: ConfigSource.PANDO_TOML,
        },
      ]

      const result = mergeMultipleConfigs(configs)

      expect(result.sources['rsync.enabled']).toBe(ConfigSource.GLOBAL_CONFIG)
      expect(result.sources['rsync.flags']).toBe(ConfigSource.PANDO_TOML)
    })

    it('should apply defaults', () => {
      const configs = [
        {
          config: { rsync: { enabled: false } },
          source: ConfigSource.GLOBAL_CONFIG,
        },
      ]

      const result = mergeMultipleConfigs(configs)

      // Should have defaults applied
      expect(result.config.rsync.flags).toEqual(DEFAULT_CONFIG.rsync.flags)
      expect(result.config.symlink.patterns).toEqual(DEFAULT_CONFIG.symlink.patterns)
    })
  })

  // ============================================================================
  // Configuration Discovery Tests
  // ============================================================================

  describe('discoverConfigFiles', () => {
    it('should find config files in current directory', async () => {
      // Create a test config file
      await fs.writeFile(path.join(tempDir, '.pando.toml'), '')
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}')

      const configFiles = await discoverConfigFiles(tempDir, tempDir)

      // Filter to only existing files in tempDir
      const existingFiles = configFiles.filter((f) => f.exists && f.path.startsWith(tempDir))

      expect(existingFiles.length).toBeGreaterThanOrEqual(2)

      const pandoToml = existingFiles.find((f) => f.source === ConfigSource.PANDO_TOML)
      expect(pandoToml).toBeDefined()
      expect(pandoToml?.exists).toBe(true)

      const packageJson = existingFiles.find((f) => f.source === ConfigSource.PACKAGE_JSON)
      expect(packageJson).toBeDefined()
      expect(packageJson?.exists).toBe(true)
    })

    it('should walk up directory tree to git root', async () => {
      // Create nested directory structure
      const subDir = path.join(tempDir, 'subdir')
      await fs.mkdir(subDir)

      // Create config at root
      await fs.writeFile(path.join(tempDir, '.pando.toml'), '')

      // Create config in subdirectory
      await fs.writeFile(path.join(subDir, 'package.json'), '{}')

      const configFiles = await discoverConfigFiles(subDir, tempDir)

      // Filter to only existing files in our temp directory tree
      const existingFiles = configFiles.filter((f) => f.exists && f.path.startsWith(tempDir))

      // Should find both configs
      expect(existingFiles.length).toBeGreaterThanOrEqual(2)

      const rootPandoToml = existingFiles.find(
        (f) => f.source === ConfigSource.PANDO_TOML && f.path.includes(tempDir)
      )
      expect(rootPandoToml).toBeDefined()

      const subDirPackageJson = existingFiles.find(
        (f) => f.source === ConfigSource.PACKAGE_JSON && f.path.includes(subDir)
      )
      expect(subDirPackageJson).toBeDefined()
    })

    it('should include global config', async () => {
      const configFiles = await discoverConfigFiles(tempDir, tempDir)

      const globalConfig = configFiles.find((f) => f.source === ConfigSource.GLOBAL_CONFIG)

      expect(globalConfig).toBeDefined()
      expect(globalConfig?.path).toBe(getGlobalConfigPath())
    })

    it('should mark non-existing files as not existing', async () => {
      const configFiles = await discoverConfigFiles(tempDir, tempDir)

      // Most files won't exist in a fresh temp directory
      const nonExistingFiles = configFiles.filter((f) => !f.exists)

      expect(nonExistingFiles.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // ConfigLoader Tests
  // ============================================================================

  describe('ConfigLoader', () => {
    let loader: ConfigLoader

    beforeEach(() => {
      loader = new ConfigLoader()
    })

    describe('load', () => {
      it('should load and merge all configs', async () => {
        // Create test config
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = false
`
        )

        const config = await loader.load({ cwd: tempDir, gitRoot: tempDir })

        expect(config.rsync.enabled).toBe(false)
        // Should have defaults for other values
        expect(config.rsync.flags).toEqual(DEFAULT_CONFIG.rsync.flags)
      })

      it('should use cache by default', async () => {
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = false
`
        )

        const config1 = await loader.load({ cwd: tempDir, gitRoot: tempDir })
        const config2 = await loader.load({ cwd: tempDir, gitRoot: tempDir })

        // Should return same object (cached)
        expect(config1).toBe(config2)
      })

      it('should skip cache when requested', async () => {
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = false
`
        )

        const config1 = await loader.load({ cwd: tempDir, gitRoot: tempDir })

        // Modify config file
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = true
`
        )

        const config2 = await loader.load({ cwd: tempDir, gitRoot: tempDir, skipCache: true })

        expect(config1.rsync.enabled).toBe(false)
        expect(config2.rsync.enabled).toBe(true)
      })

      it('should handle missing config files gracefully', async () => {
        const config = await loader.load({ cwd: tempDir, gitRoot: tempDir })

        // Should return defaults
        expect(config).toEqual(DEFAULT_CONFIG)
      })
    })

    describe('loadWithSources', () => {
      it('should track config sources', async () => {
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = false
`
        )

        const result = await loader.loadWithSources({ cwd: tempDir, gitRoot: tempDir })

        expect(result.config.rsync.enabled).toBe(false)
        expect(result.sources['rsync.enabled']).toBe(ConfigSource.PANDO_TOML)
      })

      it('should handle multiple sources', async () => {
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = false
`
        )

        await fs.writeFile(
          path.join(tempDir, 'package.json'),
          JSON.stringify({
            pando: {
              symlink: {
                patterns: ['package-lock.json'],
              },
            },
          })
        )

        const result = await loader.loadWithSources({ cwd: tempDir, gitRoot: tempDir })

        expect(result.sources['rsync.enabled']).toBe(ConfigSource.PANDO_TOML)
        expect(result.sources['symlink.patterns']).toBe(ConfigSource.PACKAGE_JSON)
      })
    })

    describe('clearCache', () => {
      it('should clear the cache', async () => {
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = false
`
        )

        const config1 = await loader.load({ cwd: tempDir, gitRoot: tempDir })

        loader.clearCache()

        // Modify config file
        await fs.writeFile(
          path.join(tempDir, '.pando.toml'),
          `
[rsync]
enabled = true
`
        )

        const config2 = await loader.load({ cwd: tempDir, gitRoot: tempDir })

        expect(config1.rsync.enabled).toBe(false)
        expect(config2.rsync.enabled).toBe(true)
      })
    })
  })

  // ============================================================================
  // Environment Variables Integration Tests
  // ============================================================================

  describe('Environment Variables Integration', () => {
    const originalEnv = process.env

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv
    })

    it('should automatically include environment variables in load()', async () => {
      // Set environment variables
      process.env = {
        ...originalEnv,
        PANDO_RSYNC_ENABLED: 'false',
        PANDO_RSYNC_FLAGS: '--archive,--verbose',
      }

      const loader = new ConfigLoader()
      const config = await loader.load({ cwd: tempDir, gitRoot: tempDir, skipCache: true })

      expect(config.rsync.enabled).toBe(false)
      expect(config.rsync.flags).toEqual(['--archive', '--verbose'])
    })

    it('should prioritize env vars over file configs', async () => {
      // Create file config
      await fs.writeFile(
        path.join(tempDir, '.pando.toml'),
        `
[rsync]
enabled = true
flags = ["--delete"]
`
      )

      // Set conflicting environment variables
      process.env = {
        ...originalEnv,
        PANDO_RSYNC_ENABLED: 'false',
      }

      const loader = new ConfigLoader()
      const config = await loader.load({ cwd: tempDir, gitRoot: tempDir, skipCache: true })

      // Env vars should win (priority 90 > 80)
      expect(config.rsync.enabled).toBe(false)
      // File config flags should be preserved since env didn't override them
      expect(config.rsync.flags).toEqual(['--delete'])
    })

    it('should track env vars as source in loadWithSources()', async () => {
      process.env = {
        ...originalEnv,
        PANDO_SYMLINK_PATTERNS: '*.json,*.lock',
      }

      const loader = new ConfigLoader()
      const result = await loader.loadWithSources({ cwd: tempDir, gitRoot: tempDir })

      expect(result.config.symlink.patterns).toEqual(['*.json', '*.lock'])
      expect(result.sources['symlink.patterns']).toBe(ConfigSource.ENV_VARS)
    })

    it('should handle no env vars gracefully', async () => {
      // Clear any PANDO_* env vars
      const cleanEnv: NodeJS.ProcessEnv = {}
      for (const key of Object.keys(originalEnv)) {
        if (!key.startsWith('PANDO_')) {
          cleanEnv[key] = originalEnv[key]
        }
      }
      process.env = cleanEnv

      const loader = new ConfigLoader()
      const config = await loader.load({ cwd: tempDir, gitRoot: tempDir, skipCache: true })

      // Should just return defaults
      expect(config).toEqual(DEFAULT_CONFIG)
    })

    it('should merge env vars with file configs correctly', async () => {
      await fs.writeFile(
        path.join(tempDir, '.pando.toml'),
        `
[rsync]
enabled = false
exclude = ["*.log"]

[symlink]
relative = false
`
      )

      process.env = {
        ...originalEnv,
        PANDO_RSYNC_FLAGS: '--archive,--delete',
        PANDO_SYMLINK_PATTERNS: '*.json',
      }

      const loader = new ConfigLoader()
      const config = await loader.load({ cwd: tempDir, gitRoot: tempDir, skipCache: true })

      // Should have both file and env configs merged
      expect(config.rsync.enabled).toBe(false) // from file
      expect(config.rsync.flags).toEqual(['--archive', '--delete']) // from env
      expect(config.rsync.exclude).toEqual(['*.log']) // from file
      expect(config.symlink.patterns).toEqual(['*.json']) // from env
      expect(config.symlink.relative).toBe(false) // from file
    })
  })

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle malformed TOML files gracefully', async () => {
      const loader = new ConfigLoader()
      const configPath = path.join(tempDir, '.pando.toml')
      await fs.writeFile(configPath, 'this is not valid toml [[[')

      // Should not throw, but log warning and continue
      await expect(loader.load({ cwd: tempDir, gitRoot: tempDir })).resolves.toBeDefined()
    })

    it('should handle malformed JSON files gracefully', async () => {
      const loader = new ConfigLoader()
      const configPath = path.join(tempDir, 'package.json')
      await fs.writeFile(configPath, '{ this is not valid json }')

      // Should not throw, but log warning and continue
      await expect(loader.load({ cwd: tempDir, gitRoot: tempDir })).resolves.toBeDefined()
    })

    it('should handle invalid config values', async () => {
      const configPath = path.join(tempDir, 'package.json')
      await fs.writeFile(
        configPath,
        JSON.stringify({
          pando: {
            rsync: {
              enabled: 'not a boolean', // Invalid type
            },
          },
        })
      )

      const loader = new ConfigLoader()

      // Validation errors are caught and logged, config loading continues with other sources
      // So this test should pass (it doesn't throw, it logs warning and uses defaults)
      const config = await loader.load({ cwd: tempDir, gitRoot: tempDir })
      expect(config).toBeDefined()
      // Should fall back to defaults since the invalid config was skipped
      expect(config.rsync.enabled).toBe(true) // DEFAULT_CONFIG value
    })
  })
})
