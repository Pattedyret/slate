import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Load .env into process.env so the Node side of tests can read the Supabase creds.
// (Vite loads .env on its own for the dev server; this is just for the test process.)
// In CI, the env vars are provided directly and this read is skipped if .env is absent.
try {
  const env = readFileSync(new URL('./.env', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  // no local .env — rely on the ambient environment (CI secrets)
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // Dedicated port (+ strictPort below) so the test server never collides with another
    // project's dev server that may already be on Vite's default 5173.
    baseURL: 'http://localhost:5179/slate/',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --port 5179 --strictPort',
    url: 'http://localhost:5179/slate/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
