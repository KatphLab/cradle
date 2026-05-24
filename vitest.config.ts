import { configDefaults, defineConfig } from 'vitest/config'
import { strictReporter } from './vitest.strict-reporter'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 10_000,
    reporters: ['default', strictReporter],
    exclude: [
      ...configDefaults.exclude,
      '**/.opencode/**',
      '**/.worktrees/**',
      '**/.pi/**',
      '**/*.cjs',
      '**/*.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,mts}'],
      exclude: [
        'src/**/__tests__/**',
        '**/test-utils/**',
        '.opencode/**',
        'src/types/**',
        '.worktrees/**',
        '.pi/**',
      ],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
})
