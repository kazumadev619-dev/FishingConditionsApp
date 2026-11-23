import { randomUUID } from 'node:crypto';
import {
  cleanupUserByEmail,
  E2E_USERS,
  expect,
  expectDashboard,
  isUserVerifiedInDb,
  readE2EState,
  test,
} from './fixtures';

type StubMail = {
  to?: string | string[];
  html?: string;
};

function matchesRecipient(mail: StubMail, email: string): boolean {
  if (Array.isArray(mail.to)) {
    return mail.to.includes(email);
  }
  return mail.to === email;
}

async function fetchVerificationUrl(email: string): Promise<string> {
  const { STUB_URL, APP_URL } = readE2EState();
  const res = await fetch(`${STUB_URL}/__mails`);
  expect(res.ok).toBe(true);
  const mails = (await res.json()) as StubMail[];
  const mail = [...mails].reverse().find((m) => matchesRecipient(m, email));
  expect(mail?.html, `確認メールがスタブに届いていません: ${email}`).toBeDefined();

  const match = mail?.html?.match(/href="([^"]*\/auth\/verify-email\?token=[^"]+)"/);
  const rawUrl = match?.[1]?.replaceAll('&amp;', '&');
  expect(rawUrl, '確認メール HTML から検証リンクを抽出できませんでした').toBeDefined();

  const verifyUrl = rawUrl as string;
  expect(verifyUrl.startsWith(APP_URL)).toBe(true);
  return verifyUrl;
}

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

  test('E2E-AUTH-03 新規登録から確認メール・確認確定を経てログインできる（docs/reference/authentication.md 1. ユーザー登録・2. ログイン）', async ({
    page,
  }) => {
    // 文言（「確認メールを送信しました」「メールアドレスが確認できていません…」「メールアドレスを確認する」
    // 「メール検証完了」など）の出どころは docs/reference/authentication-diagrams.md〈説明（参考）〉と実装。
    // 仕様（正）の authentication.md が決めているのは、遷移（/auth/check-email → /auth/verify-email →
    // /auth/verification-success → /login → /dashboard）と「リンクを開くだけでは確定しない」こと。
    // `+` 以降を除いたアドレスごとの登録回数制限（1時間3回）に当たらないよう、`+` より前を毎回一意にする
    const email = `e2e-reg-${randomUUID()}+e2e@example.test`;
    const password = 'E2e-Reg-Pass1!';

    try {
      await test.step('新規登録すると /auth/check-email に遷移する', async () => {
        await page.goto('/register');
        await page.getByLabel('名前').fill('E2E 登録テスト');
        await page.getByLabel('メールアドレス').fill(email);
        await page.getByLabel('パスワード').fill(password);
        await page.getByRole('button', { name: 'アカウント作成' }).click();

        await expect(page).toHaveURL((url) => url.pathname === '/auth/check-email');
        await expect(page.getByText('確認メールを送信しました')).toBeVisible();
      });

      await test.step('メール確認前のログインは拒否され /login に留まる', async () => {
        await page.getByRole('link', { name: 'ログインページへ' }).click();
        await expect(page).toHaveURL((url) => url.pathname === '/login');

        await page.getByLabel('メールアドレス').fill(email);
        await page.getByLabel('パスワード').fill(password);
        await page.getByRole('button', { name: 'ログイン', exact: true }).click();

        await expect(
          page.getByText(
            'メールアドレスが確認できていません。確認メールのリンクを開いてください。',
          ),
        ).toBeVisible();
        await expect(page).toHaveURL((url) => url.pathname === '/login');
      });

      await test.step('確認メールのリンクを開いただけでは確定せず、確認ボタンを押すと完了する', async () => {
        const verifyUrl = await fetchVerificationUrl(email);
        await page.goto(verifyUrl);

        await expect(page).toHaveURL((url) => url.pathname === '/auth/verify-email');
        const confirmButton = page.getByRole('button', { name: 'メールアドレスを確認する' });
        await expect(confirmButton).toBeVisible();
        expect(await isUserVerifiedInDb(email)).toBe(false);

        await confirmButton.click();

        await expect(page).toHaveURL((url) => url.pathname === '/auth/verification-success');
        await expect(page.getByText('メール検証完了')).toBeVisible();
        expect(await isUserVerifiedInDb(email)).toBe(true);
      });

      await test.step('確認完了後はログインでき、ダッシュボードが表示される', async () => {
        await page.getByRole('link', { name: 'ログインページへ' }).click();
        await expect(page).toHaveURL((url) => url.pathname === '/login');

        await page.getByLabel('メールアドレス').fill(email);
        await page.getByLabel('パスワード').fill(password);
        await page.getByRole('button', { name: 'ログイン', exact: true }).click();

        await expect(page).toHaveURL((url) => url.pathname === '/dashboard');
        await expect(
          page.getByRole('heading', { name: '東京湾（芝浦） の釣り条件' }),
        ).toBeVisible();
        await expectDashboard(page);
      });
    } finally {
      await cleanupUserByEmail(email);
    }
  });

  test('E2E-AUTH-04 サイドバーからログアウトすると /login に移り /dashboard に戻れない（docs/reference/authentication.md 3. アクセス制御, #439）', async ({
    testUserPage: page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard');

    await page.getByRole('button', { name: /@example\.test$/ }).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/login');

    await page.goto('/dashboard');
    await expect(page).toHaveURL((url) => url.pathname === '/login');
  });

  test('E2E-AUTH-05 ログイン済みで /login と /register を開くと /dashboard にリダイレクトされる（docs/reference/authentication.md 3. アクセス制御）', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/login');
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard');
    await expect(page.getByRole('heading', { name: '東京湾（芝浦） の釣り条件' })).toBeVisible();

    await page.goto('/register');
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard');
    await expect(page.getByRole('heading', { name: '東京湾（芝浦） の釣り条件' })).toBeVisible();
  });
});
