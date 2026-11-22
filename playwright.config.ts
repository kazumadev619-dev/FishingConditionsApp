import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

/**
 * `.e2e/state.env` から起動中のアプリ URL（`APP_URL`）を読み取る。
 * `scripts/e2e/up.sh` が毎回空きポートで立てるため、固定値は持たない。
 */
function readAppUrl(): string {
  const statePath = path.resolve(process.cwd(), '.e2e/state.env');
  if (!existsSync(statePath)) {
    throw new Error('.e2e/state.env が見つかりません。先に `npm run e2e:up` を実行してください。');
  }
  const content = readFileSync(statePath, 'utf8');
  const match = content.match(/^APP_URL=(.+)$/m);
  const appUrl = match?.[1]?.trim();
  if (!appUrl) {
    throw new Error(
      '.e2e/state.env に APP_URL が設定されていません。`npm run e2e:up` をやり直してください。',
    );
  }
  return appUrl;
}

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  failOnFlakyTests: isCI,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: readAppUrl(),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
