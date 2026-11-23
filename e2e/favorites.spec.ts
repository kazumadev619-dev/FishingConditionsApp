import { expect, expectDashboard, getPortId, test } from './fixtures';

test.describe('お気に入り（#439, #78）', () => {
  test('E2E-FAV-01 お気に入りに追加・削除し、再読み込み後も状態が保たれる（#439, #78）', async ({
    testUserPage: page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard');

    await test.step('お気に入りに追加し、再読み込み後も登録済みが保たれる', async () => {
      const addButton = page.getByRole('button', { name: 'お気に入りに追加' });
      await expect(addButton).toBeEnabled();
      await addButton.click();

      await expect(page).toHaveURL(/\/dashboard\?locationId=[0-9a-f-]+/);
      await expect(page.getByRole('button', { name: 'お気に入りから削除' })).toBeVisible();

      await page.reload();
      await expect(page.getByRole('button', { name: 'お気に入りから削除' })).toBeVisible();
    });

    await test.step('お気に入りから削除し、再読み込み後も未登録が保たれる', async () => {
      const removeButton = page.getByRole('button', { name: 'お気に入りから削除' });
      await expect(removeButton).toBeEnabled();

      // removeFavorite は楽観更新の直後に DELETE を投げるため、完了を待ってから reload する
      const deleteResponsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/favorites') && res.request().method() === 'DELETE',
      );
      await removeButton.click();
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.ok()).toBe(true);

      await expect(page.getByRole('button', { name: 'お気に入りに追加' })).toBeVisible();

      await page.reload();
      await expect(page.getByRole('button', { name: 'お気に入りに追加' })).toBeVisible();
    });
  });

  test('E2E-FAV-02 お気に入り一覧から場所を選ぶとその場所のダッシュボードに切り替わる（#439）', async ({
    testUserPage: page,
  }) => {
    const enoshimaPortId = await getPortId('14', '19');

    await page.goto(`/dashboard?portId=${enoshimaPortId}`);
    await expect(page.getByRole('heading', { name: '江ノ島 の釣り条件' })).toBeVisible();

    const addButton = page.getByRole('button', { name: 'お気に入りに追加' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page).toHaveURL(/\/dashboard\?locationId=[0-9a-f-]+/);
    await expect(page.getByRole('button', { name: 'お気に入りから削除' })).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: '東京湾（芝浦） の釣り条件' })).toBeVisible();

    await page.getByRole('button', { name: '釣り場' }).click();
    await page.getByRole('button', { name: 'お気に入り', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'お気に入り' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /江ノ島/ }).click();

    await expect(page).toHaveURL(/\/dashboard\?locationId=[0-9a-f-]+/);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('heading', { name: '江ノ島 の釣り条件' })).toBeVisible();
    await expectDashboard(page, { isFavorite: true });
  });
});
