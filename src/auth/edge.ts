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
const PUBLIC_PATHS = new Set(['/login', '/register']);

/**
 * 認証不要で公開するパス（前方一致）。
 *
 * - `/auth/`: メール検証リンクの着地ページ。未ログインで開くのが前提。
 * - `/api/auth/`: Auth.js 本体。proxy.ts の matcher で既に除外されており
 *   通常ここへは来ないが、意図的に重複させている。matcher を触った拍子に
 *   ここが 401 を返すようになると「ログインするためのエンドポイントに
 *   ログインが必要」になり、誰も復旧できない状態に陥るため。
 */
const PUBLIC_PREFIXES = ['/auth/', '/api/auth/'];

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
