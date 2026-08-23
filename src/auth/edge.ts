import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { baseAuthConfig } from './config';

/**
 * Edge/Proxy用の認証設定
 * ✅ proxy.tsで使用
 * ✅ Prismaなし、軽量callbacks
 * ✅ handlers不要（authのみexport）
 * ✅ authorized callback（Edge専用）
 * ❌ Node API使用不可
 */

/**
 * 認証不要で公開するパス（完全一致）。
 *
 * ここに無いパスは既定で認証必須。以前は逆（既定 allow）だったため、
 * `/api/*` がまるごと未認証で叩けた。外部 API のクォータ（OpenWeatherMap /
 * Google Maps Places）を第三者に消費されるうえ、Redis に第三者由来の
 * エントリが溜まる。
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/register',
  // メール検証リンクの着地ページ。未ログインで開くのが前提。
  // `/auth/` の前方一致にはしない。前方一致にすると、あとから
  // `src/app/auth/` にページを足した人が意図せず公開してしまい、
  // 「既定 deny なので書き忘れが穴にならない」という上の方針が崩れる。
  '/auth/verification-success',
  '/auth/verification-error',
]);

/**
 * 認証不要で公開するパス（前方一致）。
 *
 * `/api/auth/` は Auth.js 本体。`callback/google` のように可変のサブパスを
 * 多数持つため、ここだけは前方一致で許可する。
 *
 * proxy.ts の matcher で既に除外されており通常ここへは来ないが、意図的に
 * 重複させている。matcher を触った拍子にここが 401 を返すようになると
 * 「ログインするためのエンドポイントにログインが必要」になり、誰も
 * 復旧できない状態に陥るため。
 */
const PUBLIC_PREFIXES = ['/api/auth/'];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export const { auth } = NextAuth({
  ...baseAuthConfig,
  callbacks: {
    ...baseAuthConfig.callbacks,
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // ログイン済み & 認証ページ / ルート → ダッシュボードへ
      if (isLoggedIn && (PUBLIC_PATHS.has(pathname) || pathname === '/')) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      if (isPublicPath(pathname) || isLoggedIn) {
        return true;
      }

      // 未ログインで保護対象。API はリダイレクトすると呼び出し側が
      // ログインページの HTML を掴んでしまうので、401 を返して区別できるようにする。
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      return false; // pages.signIn（/login）へリダイレクト
    },
  },
});
