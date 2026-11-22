import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { assertLocal } from '../scripts/e2e/assert-local.mjs';
import { sessionCookie } from '../scripts/e2e/session-cookie.mjs';
import { E2E_USERS } from '../scripts/e2e/users.mjs';

/** docs/reference/scoring-algorithm.md「スコア表示・解釈」のランク範囲 */
const SCORE_RANK_RANGES = [
  { label: '絶好調', min: 80, max: 100 },
  { label: '良好', min: 60, max: 79 },
  { label: '普通', min: 40, max: 59 },
  { label: 'やや不利', min: 20, max: 39 },
  { label: '不適', min: 0, max: 19 },
] as const;

type SessionUser = 'verified' | 'unverified' | { id: string; email: string };

type E2EFixtures = {
  authenticatedPage: Page;
  testUserPage: Page;
};

export type E2EState = {
  APP_URL: string;
  STUB_URL: string;
  DATABASE_URL: string;
};

/**
 * `.e2e/state.env` から起動中の E2E 環境設定（APP_URL / STUB_URL / DATABASE_URL）を読み取る。
 */
export function readE2EState(): E2EState {
  const statePath = path.resolve(process.cwd(), '.e2e/state.env');
  if (!existsSync(statePath)) {
    throw new Error('.e2e/state.env が見つかりません。先に `npm run e2e:up` を実行してください。');
  }
  const content = readFileSync(statePath, 'utf8');
  const readKey = (key: string): string => {
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    const value = match?.[1]?.trim();
    if (!value) {
      throw new Error(
        `.e2e/state.env に ${key} が設定されていません。\`npm run e2e:up\` をやり直してください。`,
      );
    }
    return value;
  };
  return {
    APP_URL: readKey('APP_URL'),
    STUB_URL: readKey('STUB_URL'),
    DATABASE_URL: readKey('DATABASE_URL'),
  };
}

/**
 * ローカル E2E DB の安全確認（assertLocal）を通した上で pg.Client 処理を実行する。
 */
async function withDbClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const { DATABASE_URL } = readE2EState();
  assertLocal(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * prefecture_code と port_code から seeded 済みの ports.id を引く。
 */
export async function getPortId(prefectureCode: string, portCode: string): Promise<string> {
  return withDbClient(async (client) => {
    const res = await client.query<{ id: string }>(
      'SELECT id FROM ports WHERE prefecture_code = $1 AND port_code = $2',
      [prefectureCode, portCode],
    );
    const id = res.rows[0]?.id;
    if (!id) {
      throw new Error(
        `港が見つかりません: prefecture_code=${prefectureCode}, port_code=${portCode}`,
      );
    }
    return id;
  });
}

/**
 * 指定メールアドレスのユーザーがメール検証済み（email_verified_at IS NOT NULL）かを DB で確かめる。
 */
export async function isUserVerifiedInDb(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  return withDbClient(async (client) => {
    const res = await client.query<{ email_verified_at: Date | null }>(
      'SELECT email_verified_at FROM users WHERE email = $1',
      [normalized],
    );
    return Boolean(res.rows[0]?.email_verified_at);
  });
}

/**
 * テスト中に新規登録したユーザーと関連トークンをメールアドレスで削除する。
 * `verification_tokens` には `users` への外部キーが無いため個別に削除する（prisma/schema.prisma）。
 */
export async function cleanupUserByEmail(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  await withDbClient(async (client) => {
    await client.query('DELETE FROM verification_tokens WHERE email = $1', [normalized]);
    await client.query('DELETE FROM users WHERE email = $1', [normalized]);
  });
}

/**
 * Playwright コンテキストに E2E 用セッション Cookie（JWT）を注入する。
 */
export async function loginWithCookie(
  context: BrowserContext,
  baseURL: string,
  user: SessionUser = 'verified',
): Promise<void> {
  const cookie = await sessionCookie(user);
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      url: baseURL,
    },
  ]);
}

export const test = base.extend<E2EFixtures>({
  // ブラウザから APP_URL 以外のホストへ通信が出ないことを全テストで強制する（#439）
  context: async ({ context, baseURL }, use) => {
    if (!baseURL) {
      throw new Error('baseURL が未設定です。playwright.config.ts を確認してください。');
    }
    const allowedOrigin = new URL(baseURL).origin;
    const externalRequests: string[] = [];

    await context.route('**/*', async (route) => {
      const reqUrl = new URL(route.request().url());
      if (
        reqUrl.protocol !== 'data:' &&
        reqUrl.protocol !== 'blob:' &&
        reqUrl.origin !== allowedOrigin
      ) {
        externalRequests.push(`${route.request().method()} ${reqUrl.href}`);
        await route.abort();
        return;
      }
      await route.continue();
    });

    await use(context);

    expect(
      externalRequests,
      `外部ホストへのリクエストが発生しました: ${externalRequests.join(', ')}`,
    ).toEqual([]);
  },

  authenticatedPage: async ({ page, context, baseURL }, use) => {
    // baseURL の未設定は context fixture で検査済み（page は context の後に作られる）
    await loginWithCookie(context, baseURL as string, 'verified');
    await use(page);
  },

  // DB を書き換えるテスト用に、乱数 UUID の確認済みユーザーを作成し、終了時に削除する（user_favorites は Cascade）
  testUserPage: async ({ page, context, baseURL }, use) => {
    const id = randomUUID();
    const email = `e2e-user-${id}@example.test`;
    await withDbClient(async (client) => {
      await client.query(
        `INSERT INTO users (id, email, name, email_verified_at)
         VALUES ($1, $2, 'E2E Test User', now())`,
        [id, email],
      );
    });
    try {
      await loginWithCookie(context, baseURL as string, { id, email });
      await use(page);
    } finally {
      await withDbClient(async (client) => {
        await client.query('DELETE FROM users WHERE id = $1', [id]);
      });
    }
  },
});

/**
 * ダッシュボードの各カード・説明文・お気に入りボタン・地図代替表示を検証する。
 * 期待値の出どころ:
 * - 天気・潮汐の固定値: scripts/perf/stub.mjs（weatherResponse / tideResponse）
 * - ランクと範囲・風の注意文: docs/reference/scoring-algorithm.md
 * - お気に入り登録状態: #78, #439
 * - 地図の代替表示: docs/guides/e2e-env.md
 */
export async function expectDashboard(
  page: Page,
  options: { isFavorite?: boolean } = {},
): Promise<void> {
  const main = page.getByRole('main');

  // スコアカード: 5ランクのいずれかであり、総合スコアがそのランクの範囲内であること
  const scoreCard = main.locator('[data-slot="card"]', { hasText: '釣りやすさスコア' });
  await expect(scoreCard).toBeVisible();

  const rankStatus = scoreCard.getByRole('status', { name: /^スコアランク: / });
  await expect(rankStatus).toBeVisible();
  const rankLabel = (await rankStatus.textContent())?.trim() ?? '';
  const rankSpec = SCORE_RANK_RANGES.find((entry) => entry.label === rankLabel);
  expect(rankSpec, `想定外のスコアランク: ${rankLabel}`).toBeDefined();

  const totalScoreText = (await scoreCard.getByText(/^\d+$/).first().textContent())?.trim();
  expect(totalScoreText).toMatch(/^\d+$/);
  const totalScore = Number(totalScoreText);
  if (rankSpec) {
    expect(totalScore).toBeGreaterThanOrEqual(rankSpec.min);
    expect(totalScore).toBeLessThanOrEqual(rankSpec.max);
  }

  // 潮汐カード: スタブの固定値（満潮 02:00 / 14:30、干潮 08:40 / 19:40、大潮、月齢 12.8）
  const tideCard = main
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: /^潮汐$/ }) });
  await expect(tideCard).toBeVisible();

  const highTideGroup = tideCard.getByRole('heading', { name: '満潮' }).locator('..');
  await expect(highTideGroup).toContainText('02:00');
  await expect(highTideGroup).toContainText('14:30');

  const lowTideGroup = tideCard.getByRole('heading', { name: '干潮' }).locator('..');
  await expect(lowTideGroup).toContainText('08:40');
  await expect(lowTideGroup).toContainText('19:40');

  await expect(tideCard).toContainText('大潮');
  await expect(tideCard).toContainText('12.8');

  // 天気カード: スタブの固定値（晴天、18 °C、3.5 m/s、60 %、1015 hPa）
  // 気温は日の出・日の入り時刻（例: 18:00）と衝突しないよう単位付きで検証する
  const weatherCard = main
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: /^天気$/ }) });
  await expect(weatherCard).toBeVisible();
  await expect(weatherCard).toContainText('晴天');
  await expect(weatherCard).toContainText('18 °C');
  await expect(weatherCard).toContainText('3.5 m/s');
  await expect(weatherCard).toContainText('60 %');
  await expect(weatherCard).toContainText('1015 hPa');

  // 時間帯カード: 表示されており、現在時刻・日の出・日の入りのラベルが出ていること
  const timeCard = main
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: /^時間帯$/ }) });
  await expect(timeCard).toBeVisible();
  await expect(timeCard.getByText('現在時刻', { exact: true })).toBeVisible();
  await expect(timeCard.getByText('日の出', { exact: true })).toBeVisible();
  await expect(timeCard.getByText('日の入り', { exact: true })).toBeVisible();

  // 説明文: 表示されており、風速 3.5m/s <= 6m/s のため風の注意が含まれないこと
  const explanationHeading = main.getByRole('heading', { name: 'スコアの説明' });
  await expect(explanationHeading).toBeVisible();
  const explanationParagraph = explanationHeading.locator('..').locator('p');
  await expect(explanationParagraph).toBeVisible();
  const explanationText = (await explanationParagraph.textContent())?.trim() ?? '';
  expect(explanationText.length).toBeGreaterThan(0);
  expect(explanationText).not.toContain('風が強いため注意が必要です。');

  // お気に入りボタン: 未登録場所では「お気に入りに追加」、登録済みでは「お気に入りから削除」
  const favoriteLabel = options.isFavorite ? 'お気に入りから削除' : 'お気に入りに追加';
  await expect(main.getByRole('button', { name: favoriteLabel })).toBeVisible();

  // 地図: API キー・Map ID が空の E2E ビルドでは代替表示が出ること
  await expect(main.getByText('APIキーまたはMap IDが設定されていません')).toBeVisible();
}

export { E2E_USERS, expect };
