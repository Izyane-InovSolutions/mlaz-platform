// Browser end-to-end tests for the UI and API together. See docs/E2E_TESTING.md.
// Both servers are started here, on their own ports, against the mlaz_e2e database, so a developer's running app
// (ports 3000 and 5173, database mlaz) is never touched.
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { API_ENV, API_ORIGIN, API_URL, OUTPUT_DIR, PREVIEW_DIST, ROOT, UI_MODE, UI_PORT, UI_URL } from './e2e/support/env.ts';

const CI = !!process.env.CI;

// The UI: the dev server by default; with E2E_UI_MODE=preview, the production build served by `vite preview` (production
// Content-Security-Policy). The build goes to node_modules/.cache/mlaz-e2e/dist, so the repository's dist/ is untouched.
const UI_ARGS = `--port ${UI_PORT} --strictPort --host 127.0.0.1`;
const UI_COMMAND = UI_MODE === 'preview'
  ? `npx vite build --outDir "${PREVIEW_DIST}" --emptyOutDir --logLevel warn && npx vite preview --outDir "${PREVIEW_DIST}" ${UI_ARGS}`
  : `npx vite ${UI_ARGS}`;

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: path.join(OUTPUT_DIR, 'test-results'),
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // Specs run in parallel with each other (each has its own fixture accounts); the tests inside a spec run in order.
  fullyParallel: false,
  workers: CI ? 2 : 3,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Sandbox payments settle on the API's 10-second job tick, so a payment test can take ~30 s.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: path.join(OUTPUT_DIR, 'report'), open: 'never' }]],
  use: {
    baseURL: UI_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    // Bootstrap skips its transitions under reduced motion. Otherwise a modal moves focus to itself when its fade-in
    // ends, part-way through a field being typed, and the rest of the keystrokes are lost.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Migrate first, then run the API without watch mode, so edits to server/src during a run don't restart it.
      command: 'node ../e2e/support/prepare-db.mjs && npx tsx src/index.ts',
      cwd: path.join(ROOT, 'server'),
      // 127.0.0.1: both servers listen on IPv4 only; "localhost" may resolve to ::1 first for the readiness probe.
      url: `${API_ORIGIN.replace('localhost', '127.0.0.1')}/health`,
      env: API_ENV,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: UI_COMMAND,
      cwd: ROOT,
      url: UI_URL.replace('localhost', '127.0.0.1'),
      // Read by the dev server, and baked into the bundle by `vite build` in preview mode.
      env: { VITE_API_URL: API_URL },
      reuseExistingServer: false,
      timeout: UI_MODE === 'preview' ? 300_000 : 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
