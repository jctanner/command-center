import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 30000,
  outputDir: '../test-results/browser',
  use: { screenshot: 'only-on-failure', headless: true, viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser', args: ['--no-sandbox'] } },
});
