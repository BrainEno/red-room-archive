import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Run in the documented, pinned Playwright container. Candidates are not
// approved baselines until reviewed; see docs/UI-TESTING.md.
export default defineConfig({
  ...base,
  testDir: './tests/visual',
  projects: [{ name: 'visual-chromium', use: { browserName: 'chromium', ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] } } : {}), viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } }],
  workers: 1,
  use: { ...base.use, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark' },
});
