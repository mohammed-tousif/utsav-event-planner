import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: {
    // End-to-end tests run against the production build with sample data,
    // so they are deterministic and never spend AI quota.
    command: 'node dist/server/index.js',
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), AI_PROVIDER: 'sample', NODE_ENV: 'test', RATE_LIMIT_MAX_AI: '500', TRUST_PROXY: '0' },
  },
});
