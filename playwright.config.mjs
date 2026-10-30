import { defineConfig } from '@playwright/test';

const chromiumLaunch = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] } } : {};

// CSS viewport emulation, not physical-device certification. The browser binary
// can be overridden for restricted/local environments; CI installs Chromium.
export default defineConfig({
  testDir: './tests/ui',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    contextOptions: { reducedMotion: 'reduce' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'small-phone', use: { browserName: 'chromium', ...chromiumLaunch, viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'phone', use: { browserName: 'chromium', ...chromiumLaunch, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'breakpoint', use: { browserName: 'chromium', ...chromiumLaunch, viewport: { width: 720, height: 900 }, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'tablet', use: { browserName: 'chromium', ...chromiumLaunch, viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'firefox-phone', use: { browserName: 'firefox', viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'firefox-desktop', use: { browserName: 'firefox', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'webkit-phone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'webkit-desktop', use: { browserName: 'webkit', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'desktop', use: { browserName: 'chromium', ...chromiumLaunch, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: 'node scripts/ui-harness-server.mjs',
    url: 'http://127.0.0.1:4179/__ready',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
