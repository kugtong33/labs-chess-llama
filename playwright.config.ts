import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: [
    {
      command: 'node --import tsx tests/e2e/server.ts',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        'pnpm --filter @chess-llama/client dev -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      env: { VITE_GATEWAY_URL: 'http://127.0.0.1:3001' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
