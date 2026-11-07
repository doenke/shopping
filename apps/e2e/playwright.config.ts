import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests of the real app (built server + PWA, dev login) on a phone and a laptop.
 * Needs `pnpm build` first and a PostgreSQL (TEST_DATABASE_URL, as for the server tests).
 */
const PORT = 3998;
const DATABASE_URL = (process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres').replace(/\/[^/]*$/, '/shopping_e2e');

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'node fresh-db.mjs && node ../server/dist/main.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL,
      PUBLIC_URL: `http://localhost:${PORT}`,
      PORT: String(PORT),
      SECRET_KEY: 'e2e-secret-key-0123456789',
      DEV_LOGIN: 'true',
      LOG_LEVEL: 'warn',
    },
  },
});
