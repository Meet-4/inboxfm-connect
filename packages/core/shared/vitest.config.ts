import { defineConfig } from 'vitest/config'

// Deterministic date handling: the formula evaluator parses most date
// literals in the host's local timezone (dayjs default), so documented
// example outputs assume UTC. Setting it here — before any test module is
// loaded and before dayjs first constructs a Date — keeps date-sensitive
// tests stable across dev machines and CI.
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
})
