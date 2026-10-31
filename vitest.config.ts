import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // UI components are covered by the Playwright journeys; logic is covered here.
      include: ['src/shared/**', 'src/server/**', 'src/client/lib/**/*.ts', 'src/client/components/**/*.ts'],
      // Browser-only glue (React hooks, DOM downloads) and the process entry point are exercised end to end.
      exclude: ['src/server/index.ts', 'src/client/lib/hooks.ts', 'src/client/lib/useAppState.ts', 'src/client/components/**/use*.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
});
