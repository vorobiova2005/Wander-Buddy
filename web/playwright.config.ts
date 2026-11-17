import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end: the real app in a real browser, on a phone and on a desktop. The API is answered from fixtures
 * (e2e/*.spec.ts), so the test is fast, repeatable and never spends the Transitous or Groq quota.
 * The browser is the installed Chrome (channel "chrome") - nothing extra to download; GitHub's runners have it.
 */
const PORT = 5174

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    locale: 'uk-UA',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
