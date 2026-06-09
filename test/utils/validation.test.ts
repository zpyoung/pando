import { describe, it, expect } from 'vitest'
import { validateBranchName } from '../../src/utils/validation.js'

describe('validateBranchName', () => {
  describe('valid names', () => {
    const validNames = [
      'feature',
      'feature/login',
      'feature/login-v2',
      'fix/issue-123',
      'release/1.2.3',
      'user/john.doe/topic',
      'a',
      'WIP',
      'v1.0',
      'feat_underscore',
      'feature.branch', // dots allowed when not leading/trailing and not '..'
    ]

    for (const name of validNames) {
      it(`accepts '${name}'`, () => {
        const result = validateBranchName(name)
        expect(result.valid).toBe(true)
        expect(result.reason).toBeUndefined()
      })
    }
  })

  describe('invalid names', () => {
    it('rejects empty string', () => {
      const result = validateBranchName('')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/empty/i)
    })

    it('rejects names containing spaces', () => {
      const result = validateBranchName('feature branch')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/whitespace|control/i)
    })

    it('rejects names containing tabs', () => {
      expect(validateBranchName('feature\tbranch').valid).toBe(false)
    })

    it('rejects names containing newlines', () => {
      expect(validateBranchName('feature\nbranch').valid).toBe(false)
    })

    it('rejects names containing control characters', () => {
      // \x07 is the BEL control character (code 0x07)
      expect(validateBranchName('feature\x07branch').valid).toBe(false)
      // \x7f is DEL (code 0x7f)
      expect(validateBranchName('feature\x7fbranch').valid).toBe(false)
    })

    it("rejects names containing '..'", () => {
      const result = validateBranchName('feature..branch')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/\.\./)
    })

    it.each(['~', '^', ':', '?', '*', '[', '\\'])("rejects names containing '%s'", (char) => {
      const result = validateBranchName(`feature${char}branch`)
      expect(result.valid).toBe(false)
    })

    it("rejects names containing '@{'", () => {
      const result = validateBranchName('feature@{0}')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/@\{/)
    })

    it("rejects a single '@'", () => {
      const result = validateBranchName('@')
      expect(result.valid).toBe(false)
    })

    it("rejects names beginning with '-'", () => {
      const result = validateBranchName('-feature')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/begin/i)
    })

    it("rejects names beginning with '.'", () => {
      expect(validateBranchName('.feature').valid).toBe(false)
    })

    it("rejects names beginning with '/'", () => {
      expect(validateBranchName('/feature').valid).toBe(false)
    })

    it("rejects names ending with '/'", () => {
      const result = validateBranchName('feature/')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/end/i)
    })

    it("rejects names ending with '.'", () => {
      expect(validateBranchName('feature.').valid).toBe(false)
    })

    it("rejects names ending with '.lock'", () => {
      const result = validateBranchName('feature.lock')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/\.lock/)
    })

    it('rejects a shell-injection-style name', () => {
      expect(validateBranchName('foo; rm -rf /').valid).toBe(false)
    })
  })
})
