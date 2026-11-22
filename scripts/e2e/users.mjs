// E2E 専用の固定値。本番・ローカル開発の値とは無関係のダミーなので、リポジトリに置いてよい。
// seed-users.mjs（DB に入れる）、session-cookie.mjs（Cookie を作る）、up.sh（アプリの AUTH_SECRET）が使う。
// #439 の Playwright からもここを import する。
export const E2E_AUTH_SECRET = 'e2e-only-secret-not-used-anywhere-else';

export const E2E_USERS = {
  // メール確認済み。ログインできる
  verified: {
    id: '00000000-0000-4000-8000-0000000e2e01',
    email: 'e2e-verified@example.test',
    password: 'E2e-Password-1!',
    verified: true,
  },
  // メール未確認。ログインは拒否される
  unverified: {
    id: '00000000-0000-4000-8000-0000000e2e02',
    email: 'e2e-unverified@example.test',
    password: 'E2e-Password-1!',
    verified: false,
  },
};
