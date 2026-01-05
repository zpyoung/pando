import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 120000, // 2 minutes per test (container operations are slow)
    hookTimeout: 600000, // 10 minutes for beforeAll/afterAll (container startup + npm install in Dockerfile)
    pool: 'forks', // Use forks for better isolation
    poolOptions: {
      forks: {
        singleFork: true, // Run tests in single fork for container reuse
      },
    },
    // Slower tests, run sequentially to avoid Docker resource contention
    sequence: {
      concurrent: false,
    },
    // Reporter for local visibility (no CI reporters since this is local-only)
    reporters: ['verbose'],
    outputFile: {
      junit: './test-results/e2e-published-junit.xml',
    },
    // Set environment variable for published mode
    env: {
      PANDO_E2E_PUBLISHED: 'true',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
