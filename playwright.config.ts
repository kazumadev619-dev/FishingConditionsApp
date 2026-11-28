import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

/** `scripts/e2e/up.sh` が書いた `.e2e/state.env` を読む。 */
function readState(): string {
  const statePath = path.resolve(process.cwd(), '.e2e/state.env');
  if (!existsSync(statePath)) {
    throw new Error('.e2e/state.env が見つかりません。先に `npm run e2e:up` を実行してください。');
  }
  return readFileSync(statePath, 'utf8');
}

/**
 * 起動中のアプリ URL（`APP_URL`）を取り出す。
 * `scripts/e2e/up.sh` が毎回空きポートで立てるため、固定値は持たない。
 */
function readAppUrl(content: string): string {
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
const state = readState();
// Maps のダミーのキーでビルドした環境（E2E_MAPS_KEY と E2E_MAPS_MAP_ID 付きの e2e:up）では、初期化の失敗の E2E だけを流す。
// ほかのテストは、キーが空のビルドの代替表示を前提にしている（docs/guides/e2e-env.md）
const MAP_INIT_FAILURE_SPEC = 'map-init-failure.spec.ts';
const mapsKeySet = /^MAPS_KEY_SET=1$/m.test(state);
// ファイルを指定して流したときに、理由が出ないまま「No tests found」にならないよう知らせる（ワーカーでは出さない）
if (mapsKeySet && !process.env.TEST_WORKER_INDEX) {
  console.warn(
    `Maps のダミーのキーの環境なので、${MAP_INIT_FAILURE_SPEC} だけを流します。ほかのテストは npm run e2e:up で立て直してから流してください。`,
  );
}

export default defineConfig({
  testDir: './e2e',
  ...(mapsKeySet ? { testMatch: MAP_INIT_FAILURE_SPEC } : { testIgnore: MAP_INIT_FAILURE_SPEC }),
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  failOnFlakyTests: isCI,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: readAppUrl(state),
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
