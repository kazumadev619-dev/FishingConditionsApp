import { expect, expectDashboard, test } from './fixtures';

test.describe('場所選択（#439）', () => {
  test('E2E-LOC-01 「港から選ぶ」で都道府県と港を選ぶとその港のダッシュボードに切り替わる（#439, code.csv, docs/reference/scoring-algorithm.md）', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard');

    await page.getByRole('button', { name: '釣り場' }).click();
    await page.getByRole('tab', { name: '港' }).click();

    await page.getByRole('combobox', { name: '都道府県' }).click();
    await page.getByRole('option', { name: '神奈川県' }).click();

    await page.getByRole('combobox', { name: '港' }).click();
    await page.getByRole('option', { name: '江ノ島' }).click();

    await expect(page).toHaveURL(/\/dashboard\?portId=[0-9a-f-]+/);
    await expect(page.getByRole('heading', { name: '江ノ島 の釣り条件' })).toBeVisible();
    await expectDashboard(page);
  });

  test('E2E-LOC-02 「自由検索」で候補を選ぶとその場所のダッシュボードに切り替わる（#439, scripts/perf/stub.mjs）', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard');

    await page.getByRole('button', { name: '釣り場' }).click();
    await page.getByRole('tab', { name: '検索' }).click();

    await page.getByRole('textbox', { name: '場所を検索' }).fill('東京');

    const candidate = page.getByRole('button', { name: /スタブ地点0/ });
    await expect(candidate).toBeVisible();
    await candidate.click();

    await expect(page).toHaveURL(/\/dashboard\?lat=35\.6&lng=139\.7&name=/);
    await expect(page.getByRole('heading', { name: 'スタブ地点0 の釣り条件' })).toBeVisible();
    await expectDashboard(page);
  });
});
