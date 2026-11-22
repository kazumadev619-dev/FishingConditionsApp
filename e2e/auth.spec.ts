import { E2E_USERS, expect, expectDashboard, test } from './fixtures';

test.describe('認証とアクセス制御（docs/reference/authentication.md）', () => {
  test('E2E-AUTH-01 未ログインで /dashboard を開くと /login に移り、ログインするとダッシュボードが表示される（docs/reference/authentication.md 2. ログイン・3. アクセス制御, docs/reference/scoring-algorithm.md）', async ({
    page,
  }) => {
    await test.step('未ログインで /dashboard にアクセスすると /login にリダイレクトされる', async () => {
      await page.goto('/dashboard');
      await expect(page).toHaveURL((url) => url.pathname === '/login');
    });

    await test.step('確認済みユーザーでログインすると /dashboard に遷移し各カードが表示される', async () => {
      await page.getByLabel('メールアドレス').fill(E2E_USERS.verified.email);
      await page.getByLabel('パスワード').fill(E2E_USERS.verified.password);
      await page.getByRole('button', { name: 'ログイン', exact: true }).click();

      await expect(page).toHaveURL((url) => url.pathname === '/dashboard');
      await expect(page.getByRole('heading', { name: '東京湾（芝浦） の釣り条件' })).toBeVisible();
      await expectDashboard(page);
    });
  });

  test('E2E-AUTH-02 間違ったパスワードでログインするとエラーが表示され、/dashboard へも入れない（docs/reference/authentication.md 2. ログイン・3. アクセス制御）', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.getByLabel('メールアドレス').fill(E2E_USERS.verified.email);
    await page.getByLabel('パスワード').fill('Wrong-Password-1!');
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();

    await expect(
      page.getByText('メールアドレスまたはパスワードが正しくありません。'),
    ).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === '/login');

    await page.goto('/dashboard');
    await expect(page).toHaveURL((url) => url.pathname === '/login');
  });
});
