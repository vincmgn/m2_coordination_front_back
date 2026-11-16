import { defineConfig, devices } from '@playwright/test'

// Tests de bout en bout sur la pile Docker (cd ../movies-api-loadtest && docker compose up -d) :
// front servi par nginx sur :8081, Jaeger sur :16686.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:8081' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
