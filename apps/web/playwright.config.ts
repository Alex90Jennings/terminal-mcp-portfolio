import { defineConfig, devices } from '@playwright/test';

const port = 3100;

/** Runs against the production build: `npm run build` first (the `test:e2e` script does). */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: `npx next start --port ${port} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // A local production server: in-memory limits (refused on Vercel) and the scripted model, so no
    // AWS credentials and no paid calls. The transcript secret is a test value, not a real one.
    env: {
      RATE_LIMIT_BACKEND: 'memory',
      MCP_RATE_LIMIT_PER_MINUTE: '1000',
      AI_PROVIDER: 'scripted',
      AI_QUESTIONS_PER_MINUTE: '60',
      AI_QUESTIONS_PER_DAY: '1000',
      CHAT_TRANSCRIPT_SECRET: 'playwright-test-secret-not-used-anywhere-else',
    },
  },
});
