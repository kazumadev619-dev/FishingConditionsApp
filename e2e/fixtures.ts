import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
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
};

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
    if (!baseURL) {
      throw new Error('baseURL が未設定です。playwright.config.ts を確認してください。');
    }
    await loginWithCookie(context, baseURL, 'verified');
    await use(page);
  },
});

/**
 * ダッシュボードの各カード・説明文・お気に入りボタン・地図代替表示を検証する。
 * 期待値の出どころ:
 * - 天気・潮汐の固定値: scripts/perf/stub.mjs（weatherResponse / tideResponse）
 * - ランクと範囲・風の注意文: docs/reference/scoring-algorithm.md
 * - お気に入り未登録状態: #78, #439
 * - 地図の代替表示: docs/guides/e2e-env.md
 */
export async function expectDashboard(page: Page): Promise<void> {
  // スコアカード: 5ランクのいずれかであり、総合スコアがそのランクの範囲内であること
  const scoreCard = page.locator('[data-slot="card"]', { hasText: '釣りやすさスコア' });
  await expect(scoreCard).toBeVisible();

  const rankStatus = scoreCard.getByRole('status', { name: /^スコアランク: / });
  await expect(rankStatus).toBeVisible();
  const rankLabel = (await rankStatus.textContent())?.trim() ?? '';
  const rankSpec = SCORE_RANK_RANGES.find((entry) => entry.label === rankLabel);
  expect(rankSpec, `想定外のスコアランク: ${rankLabel}`).toBeDefined();

  const totalScoreText = (
    await rankStatus.locator('..').locator('span').first().textContent()
  )?.trim();
  expect(totalScoreText).toMatch(/^\d+$/);
  const totalScore = Number(totalScoreText);
  if (rankSpec) {
    expect(totalScore).toBeGreaterThanOrEqual(rankSpec.min);
    expect(totalScore).toBeLessThanOrEqual(rankSpec.max);
  }

  // 潮汐カード: スタブの固定値（満潮 02:00 / 14:30、干潮 08:40 / 19:40、大潮、月齢 12.8）
  const tideCard = page
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
  const weatherCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: /^天気$/ }) });
  await expect(weatherCard).toBeVisible();
  await expect(weatherCard).toContainText('晴天');
  await expect(weatherCard).toContainText('18');
  await expect(weatherCard).toContainText('3.5');
  await expect(weatherCard).toContainText('60');
  await expect(weatherCard).toContainText('1015');

  // 説明文: 表示されており、風速 3.5m/s <= 6m/s のため風の注意が含まれないこと
  const explanationHeading = page.getByRole('heading', { name: 'スコアの説明' });
  await expect(explanationHeading).toBeVisible();
  const explanationParagraph = explanationHeading.locator('..').locator('p');
  await expect(explanationParagraph).toBeVisible();
  const explanationText = (await explanationParagraph.textContent())?.trim() ?? '';
  expect(explanationText.length).toBeGreaterThan(0);
  expect(explanationText).not.toContain('風が強いため注意が必要です。');

  // お気に入りボタン: 未登録場所では「お気に入りに追加」
  await expect(page.getByRole('button', { name: 'お気に入りに追加' })).toBeVisible();

  // 地図: API キー・Map ID が空の E2E ビルドでは代替表示が出ること
  await expect(page.getByText('APIキーまたはMap IDが設定されていません')).toBeVisible();
}

export { E2E_USERS, expect };
