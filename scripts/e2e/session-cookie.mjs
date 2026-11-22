// DB にいる E2E ユーザーとして通れるセッション Cookie（JWT）を作る。ログインの画面を通さずに済ませる用。
//
//   node scripts/e2e/session-cookie.mjs [verified|unverified]   → "名前=値" を1行で出す
//
// Playwright からは sessionCookie() を import する。アプリの AUTH_SECRET と同じ値で署名する必要があり、
// up.sh は E2E_AUTH_SECRET を渡して起動する。AUTH_URL が http なので Cookie 名に __Secure- は付かない。
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { encode } from 'next-auth/jwt';
import { E2E_AUTH_SECRET, E2E_USERS } from './users.mjs';

export const COOKIE_NAME = 'authjs.session-token';

/**
 * テスト用のセッション Cookie（JWT）を生成する。
 * @param {'verified' | 'unverified'} [which='verified']
 * @param {string} [secret=E2E_AUTH_SECRET]
 * @returns {Promise<{ name: string; value: string }>}
 */
export async function sessionCookie(which = 'verified', secret = E2E_AUTH_SECRET) {
  const u = E2E_USERS[which];
  if (!u?.id || !u.email) {
    throw new Error(`知らない E2E ユーザー: ${which}`);
  }
  const value = await encode({
    token: { id: u.id, email: u.email, sub: u.id },
    secret,
    salt: COOKIE_NAME,
    maxAge: 60 * 60 * 6,
  });
  return { name: COOKIE_NAME, value };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { name, value } = await sessionCookie(process.argv[2]);
  console.log(`${name}=${value}`);
}
