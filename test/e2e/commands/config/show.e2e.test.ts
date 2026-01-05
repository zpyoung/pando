import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../../helpers/container.js'
import { setupGitRepo } from '../../helpers/git-repo.js'
import {
  pandoConfigShow,
  pandoConfigInit,
  runPando,
  pandoConfigShowHuman,
} from '../../helpers/cli-runner.js'
import { expectSuccess, expectConfigShowHuman } from '../../helpers/assertions.js'

describe('pando config show (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
  })

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  beforeEach(async () => {
    // Create a fresh repo for each test
    const testId = Math.random().toString(36).substring(7)
    repoPath = await setupGitRepo(container, {
      name: `config-show-repo-${testId}`,
      files: [{ path: 'README.md', content: '# Test' }],
    })
  })

  describe('displaying configuration', () => {
    it('should display default configuration when no config file exists', async () => {
      const result = await pandoConfigShow(container, repoPath)

      expectSuccess(result)
      expect(result.json).toBeDefined()

      // Should have default sections
      expect(result.json?.rsync).toBeDefined()
      expect(result.json?.symlink).toBeDefined()
    })

    it('should display merged configuration from config file', async () => {
      // Initialize config first
      await pandoConfigInit(container, repoPath)

      const result = await pandoConfigShow(container, repoPath)

      expectSuccess(result)
      expect(result.json?.rsync).toBeDefined()
      expect(result.json?.symlink).toBeDefined()
      expect(result.json?.worktree).toBeDefined()
    })

    it('should reflect custom config values', async () => {
      // Create custom config
      await container.exec([
        'sh',
        '-c',
        `cat > ${repoPath}/.pando.toml << 'EOF'
[rsync]
enabled = false
flags = ["-avz", "--custom"]

[symlink]
patterns = ["package.json", "tsconfig.json"]
EOF`,
      ])

      const result = await pandoConfigShow(container, repoPath)

      expectSuccess(result)
      expect((result.json?.rsync as { enabled: boolean })?.enabled).toBe(false)
      expect((result.json?.symlink as { patterns: string[] })?.patterns).toContain('package.json')
    })
  })

  describe('source tracking', () => {
    it('should show sources with --sources flag', async () => {
      await pandoConfigInit(container, repoPath)

      const result = await runPando(container, {
        command: 'config show',
        args: ['--sources'],
        cwd: repoPath,
        json: true,
      })

      expectSuccess(result)
      // Sources info should be present
      expect(result.json?.sources || result.stdout).toBeDefined()
    })
  })

  describe('config precedence', () => {
    it('should show config from project root when in subdirectory', async () => {
      // Create config in repo root
      await container.exec([
        'sh',
        '-c',
        `cat > ${repoPath}/.pando.toml << 'EOF'
[rsync]
enabled = true
EOF`,
      ])

      // Create subdirectory and run from there
      await container.exec(['mkdir', '-p', `${repoPath}/src/deep/nested`])

      const result = await runPando(container, {
        command: 'config show',
        cwd: `${repoPath}/src/deep/nested`,
        json: true,
      })

      expectSuccess(result)
      expect((result.json?.rsync as { enabled: boolean })?.enabled).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should work even when not in a git repository', async () => {
      await container.exec(['mkdir', '-p', '/tmp/not-a-repo'])

      const result = await runPando(container, {
        command: 'config show',
        cwd: '/tmp/not-a-repo',
        json: true,
      })

      // Should still show default config (or handle gracefully)
      expectSuccess(result)
    })

    it('should display errors for malformed TOML config (JSON output)', async () => {
      // Create malformed .pando.toml
      await container.exec([
        'sh',
        '-c',
        `echo 'this is not valid toml [[[' > ${repoPath}/.pando.toml`,
      ])

      const result = await pandoConfigShow(container, repoPath)

      // Should exit with code 1 for project config errors
      expect(result.exitCode).toBe(1)

      // Should have errors in JSON output
      expect(result.json?.errors).toBeDefined()
      const errors = result.json?.errors as Array<{
        path: string
        isProjectConfig: boolean
        message: string
      }>
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].isProjectConfig).toBe(true)
      expect(errors[0].path).toContain('.pando.toml')

      // Should still include default config
      expect(result.json?.rsync).toBeDefined()
    })

    it('should display errors for malformed TOML config (human-readable output)', async () => {
      // Create malformed .pando.toml
      await container.exec(['sh', '-c', `echo 'invalid = [[[' > ${repoPath}/.pando.toml`])

      const result = await pandoConfigShowHuman(container, repoPath)

      // Should exit with code 1 for project config errors
      expect(result.exitCode).toBe(1)

      // Should show error message with [PROJECT] label
      expect(result.stdout).toContain('[PROJECT]')
      expect(result.stdout).toContain('.pando.toml')
      expect(result.stdout.toLowerCase()).toContain('error')

      // Should still show configuration after errors
      expect(result.stdout).toContain('[rsync]')
    })

    it('should show errors alongside valid config from other sources', async () => {
      // Create malformed .pando.toml
      await container.exec(['sh', '-c', `echo 'not valid toml' > ${repoPath}/.pando.toml`])

      // Create valid package.json with pando config
      await container.exec([
        'sh',
        '-c',
        `echo '{"name": "test", "pando": {"symlink": {"patterns": ["package.json"]}}}' > ${repoPath}/package.json`,
      ])

      const result = await pandoConfigShow(container, repoPath)

      // Should exit with code 1 (project config has error)
      expect(result.exitCode).toBe(1)

      // Should have error for .pando.toml
      const errors = result.json?.errors as Array<{ path: string }>
      expect(errors.some((e) => e.path.includes('.pando.toml'))).toBe(true)

      // Should still include config from valid package.json
      const symlink = result.json?.symlink as { patterns: string[] }
      expect(symlink?.patterns).toContain('package.json')
    })

    it('should exit with code 0 when config is valid', async () => {
      // Create valid .pando.toml
      await container.exec([
        'sh',
        '-c',
        `cat > ${repoPath}/.pando.toml << 'EOF'
[rsync]
enabled = true
EOF`,
      ])

      const result = await pandoConfigShow(container, repoPath)

      // Should exit with code 0 for valid config
      expect(result.exitCode).toBe(0)

      // Should not have errors
      expect(result.json?.errors).toBeUndefined()
    })
  })

  describe('human-readable output', () => {
    it('should show complete config output with header, sections, and all settings', async () => {
      await pandoConfigInit(container, repoPath)

      const result = await pandoConfigShowHuman(container, repoPath)

      // Comprehensive check: Configuration header, [rsync], [symlink], settings
      expectConfigShowHuman(result, {
        sections: ['rsync', 'symlink'],
      })
    })

    it('should show rsync section with enabled, flags, and exclude settings', async () => {
      await pandoConfigInit(container, repoPath)

      const result = await pandoConfigShowHuman(container, repoPath)

      expectSuccess(result)
      const output = result.stdout

      // Must show Configuration header
      expect(output.toLowerCase()).toContain('configuration')

      // Must show [rsync] section
      expect(output).toContain('[rsync]')

      // Must show rsync settings
      expect(output.toLowerCase()).toContain('enabled')
      expect(output.toLowerCase()).toContain('flags')
      expect(output.toLowerCase()).toContain('exclude')
    })

    it('should show symlink section with patterns and relative settings', async () => {
      await pandoConfigInit(container, repoPath)

      const result = await pandoConfigShowHuman(container, repoPath)

      expectSuccess(result)
      const output = result.stdout

      // Must show [symlink] section
      expect(output).toContain('[symlink]')

      // Must show symlink settings
      expect(output.toLowerCase()).toContain('patterns')
      expect(output.toLowerCase()).toContain('relative')
    })

    it('should show custom values from config file', async () => {
      // Create custom config
      await container.exec([
        'sh',
        '-c',
        `cat > ${repoPath}/.pando.toml << 'EOF'
[rsync]
enabled = false
EOF`,
      ])

      const result = await pandoConfigShowHuman(container, repoPath)

      expectConfigShowHuman(result, {
        customValues: { enabled: 'false' },
      })
    })

    it('should show Configuration sources section with --sources flag', async () => {
      await pandoConfigInit(container, repoPath)

      const result = await pandoConfigShowHuman(container, repoPath, ['--sources'])

      expectConfigShowHuman(result, {
        showSources: true,
      })
    })
  })
})
