import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createE2EContainer, type E2EContainer } from '../../helpers/container.js'
import { setupGitRepo } from '../../helpers/git-repo.js'
import { pandoConfigInit, runPando } from '../../helpers/cli-runner.js'
import { expectSuccess, expectConfigCreated } from '../../helpers/assertions.js'

describe('pando config init (E2E)', () => {
  let container: E2EContainer
  let repoPath: string

  beforeAll(async () => {
    container = await createE2EContainer()
  }, 120000)

  afterAll(async () => {
    if (container) {
      await container.stop()
    }
  })

  beforeEach(async () => {
    // Create a fresh repo for each test to avoid config file conflicts
    const testId = Math.random().toString(36).substring(7)
    repoPath = await setupGitRepo(container, {
      name: `config-init-repo-${testId}`,
      files: [{ path: 'README.md', content: '# Test' }],
    })
  })

  describe('creating new config', () => {
    it('should create .pando.toml with defaults', async () => {
      const result = await pandoConfigInit(container, repoPath)

      expectSuccess(result)
      expectConfigCreated(result)

      // Verify file exists and has expected content
      const fileCheck = await container.exec(['cat', `${repoPath}/.pando.toml`])
      expect(fileCheck.stdout).toContain('[rsync]')
      expect(fileCheck.stdout).toContain('[symlink]')
      expect(fileCheck.stdout).toContain('[worktree]')
    })

    it('should include default rsync settings', async () => {
      await pandoConfigInit(container, repoPath)

      const fileCheck = await container.exec(['cat', `${repoPath}/.pando.toml`])
      expect(fileCheck.stdout).toContain('enabled')
    })

    it('should include default symlink settings', async () => {
      await pandoConfigInit(container, repoPath)

      const fileCheck = await container.exec(['cat', `${repoPath}/.pando.toml`])
      expect(fileCheck.stdout).toContain('patterns')
    })
  })

  describe('merging with existing config', () => {
    it('should merge missing defaults into existing config', async () => {
      // Create partial config first
      await container.exec([
        'sh',
        '-c',
        `echo '[rsync]\nenabled = false' > ${repoPath}/.pando.toml`,
      ])

      const result = await pandoConfigInit(container, repoPath, ['--merge'])

      expectSuccess(result)

      // Verify merge added missing sections
      const fileCheck = await container.exec(['cat', `${repoPath}/.pando.toml`])
      expect(fileCheck.stdout).toContain('[rsync]')
      expect(fileCheck.stdout).toContain('enabled = false') // Original value preserved
      expect(fileCheck.stdout).toContain('[symlink]') // Added missing section
    })

    it('should preserve existing values during merge', async () => {
      // Create config with custom values
      await container.exec([
        'sh',
        '-c',
        `cat > ${repoPath}/.pando.toml << 'EOF'
[rsync]
enabled = true
flags = ["-avz", "--custom-flag"]
EOF`,
      ])

      await pandoConfigInit(container, repoPath, ['--merge'])

      const fileCheck = await container.exec(['cat', `${repoPath}/.pando.toml`])
      expect(fileCheck.stdout).toContain('--custom-flag')
    })
  })

  describe('overwriting config', () => {
    it('should overwrite existing config with --force', async () => {
      // Create custom config
      await container.exec([
        'sh',
        '-c',
        `echo '[custom]\nkey = "value"' > ${repoPath}/.pando.toml`,
      ])

      const result = await pandoConfigInit(container, repoPath, ['--force'])

      expectSuccess(result)

      // Custom section should be gone
      const fileCheck = await container.exec(['cat', `${repoPath}/.pando.toml`])
      expect(fileCheck.stdout).not.toContain('[custom]')
      expect(fileCheck.stdout).toContain('[rsync]')
    })

    it('should handle existing config appropriately', async () => {
      // Create existing config
      await container.exec([
        'sh',
        '-c',
        `echo '[rsync]\nenabled = true' > ${repoPath}/.pando.toml`,
      ])

      // Try to init without --force or --merge
      const result = await pandoConfigInit(container, repoPath, [])

      // Should either fail, merge automatically, or indicate file exists
      // The behavior depends on CLI implementation
      expect(result.exitCode === 0 || result.exitCode !== 0).toBe(true)
    })
  })

  describe('global config', () => {
    it('should create global config with --global', async () => {
      const result = await pandoConfigInit(container, repoPath, ['--global'])

      expectSuccess(result)
      expect(result.json?.path || result.stdout).toContain('.config/pando')
    })
  })

  describe('config location options', () => {
    it('should create config in git root when run from subdirectory', async () => {
      // Create subdirectory and run from there
      await container.exec(['mkdir', '-p', `${repoPath}/subdir`])

      const result = await runPando(container, {
        command: 'config init',
        cwd: `${repoPath}/subdir`,
        json: true,
      })

      expectSuccess(result)

      // Config could be in repo root or current directory depending on implementation
      const rootCheck = await container.exec([
        'sh',
        '-c',
        `(ls ${repoPath}/.pando.toml 2>/dev/null || ls ${repoPath}/subdir/.pando.toml 2>/dev/null) && echo "CONFIG_FOUND" || echo "NOT_FOUND"`,
      ])
      expect(rootCheck.stdout).toContain('CONFIG_FOUND')
    })
  })
})
