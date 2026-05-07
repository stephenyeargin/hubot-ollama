import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text', 'clover'],
      reportsDirectory: './test-results',
      exclude: ['node_modules/**', 'eslint.config.mjs', 'vitest.config.mjs'],
    },
  },
});
