import { expect, it } from 'vitest';
import { baseAuthConfig } from './config';

it('認証の拒否はログインページに戻す', () => {
  expect(baseAuthConfig.pages.error).toBe('/login');
});

// 守る状態: ログインに成功したら、ダッシュボードへ遷移する。
// 遷移先を決めているのは、この redirect コールバックだけ（authenticate は成功時に自分では遷移しない）。
// 期待値: docs/reference/authentication.md「2. ログイン」の4、「4. Google OAuth認証」の9（成功すると /dashboard へ）
// 外部の url が渡されても、サイトの外へ出さない（遷移先の候補は、フォームの redirectTo で利用者が指定できる。
// 外へ出ないように守っているのは、このコールバックだけ）
const { redirect } = baseAuthConfig.callbacks;

it.each([
  ['既定の遷移先（baseUrl）が渡されたとき', 'https://app.test'],
  ['外部サイトの url が渡されたとき', 'https://evil.example/phish'],
  ['相対パスが渡されたとき', '/settings'],
])('ログイン成功の遷移先は、%s も baseUrl の /dashboard になる', async (_case, url) => {
  await expect(redirect({ url, baseUrl: 'https://app.test' })).resolves.toBe(
    'https://app.test/dashboard',
  );
});
