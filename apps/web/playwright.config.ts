import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for the ruletka.top web app.
 *
 * The CI gate is responsible for booting the stack (the Next.js app on :3000
 * and the NestJS API on :4000) BEFORE invoking `playwright test`, so this
 * config deliberately does NOT declare a `webServer` that builds/starts the app
 * — it simply assumes `baseURL` is already serving. Tests use relative paths
 * (e.g. `page.goto('/login')`) which resolve against `baseURL`.
 *
 * Specs are written to be resilient: they prefer role/label/text selectors over
 * brittle CSS, tolerate a missing backend where a flow would otherwise require
 * one, and never depend on a pre-existing logged-in session (the tests that
 * need auth seed it themselves).
 */
export default defineConfig({
  testDir: './e2e',

  /* Run files in parallel; safe because each test owns its own browser context. */
  fullyParallel: true,

  /* Never allow an accidental `test.only` to pass CI silently. */
  forbidOnly: !!process.env.CI,

  /* A single retry on CI smooths over first-load/hydration races. */
  retries: process.env.CI ? 1 : 0,

  /* Keep CI deterministic; let local runs use all cores. */
  workers: process.env.CI ? 1 : undefined,

  /* Concise terminal output + an HTML report for debugging failures. */
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  /* Per-test budget. The app is animation-heavy, so allow some headroom. */
  timeout: 30_000,

  expect: {
    /* Web-first assertions auto-retry up to this budget. */
    timeout: 7_500,
  },

  use: {
    /* All relative navigations resolve against the locally-served app. */
    baseURL: 'http://localhost:3000',

    /* Capture a trace only when a test is retried, to keep runs fast. */
    trace: 'on-first-retry',

    /* Screenshot/video artifacts only on failure. */
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    /* Bound per-action and per-navigation waits so a hung request fails fast. */
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
