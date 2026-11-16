import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:8081' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
