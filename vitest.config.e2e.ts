import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 120000, // 2 minutes per test (container operations are slow)
    hookTimeout: 600000, // 10 minutes for beforeAll/afterAll (container startup + image build on first run)
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
    // Reporter for CI visibility
    reporters: process.env.CI ? ['verbose', 'junit'] : ['verbose'],
    outputFile: {
      junit: './test-results/e2e-junit.xml',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
