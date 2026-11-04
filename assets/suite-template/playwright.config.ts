import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'qa.config.json'), 'utf8'));

// Optional: BROWSER_CHANNEL=chrome (or msedge) runs the tests in the browser installed on this machine.
const channel = process.env.BROWSER_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results/results.json' }], ['html', { open: 'never', outputFolder: 'results/html' }]],
  use: { baseURL: process.env.BASE_URL ?? cfg.baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], channel } },
  ],
});
