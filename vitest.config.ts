import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'test/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Measure only the real source tree. Without an explicit `include`, the
      // v8 provider walks the whole working directory and picks up duplicate
      // `src/` copies under local git worktrees (e.g. .worktrees/**,
      // .claude/worktrees/**), which dilutes every metric to near-zero and
      // makes thresholds meaningless.
      include: ['src/**/*.ts'],
      exclude: ['node_modules', 'dist', 'test', '**/*.test.ts', '**/*.config.ts', 'bin'],
      // Thresholds are set ~5 points below the current unit-test actuals (and
      // capped at 70) so they enforce a floor without immediately failing.
      // Actuals at time of writing: statements 65.5%, branches 84.1%,
      // functions 83.2%, lines 65.5%. Statements/lines are held back by the
      // command files that are exercised only by the Docker e2e suite
      // (add.ts, branch/backup.ts, branch/restore.ts), which do not contribute
      // to unit-run coverage.
      thresholds: {
        statements: 60,
        branches: 70,
        functions: 70,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
