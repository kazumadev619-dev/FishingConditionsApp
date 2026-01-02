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
export const { auth } = NextAuth({
  ...baseAuthConfig,
  callbacks: {
    ...baseAuthConfig.callbacks,
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
      const isOnAuth = nextUrl.pathname === '/login' || nextUrl.pathname === '/register';
      const isOnRoot = nextUrl.pathname === '/';

      // 未ログイン & ダッシュボードアクセス → ログインページへ
      if (isOnDashboard && !isLoggedIn) {
        return false; // /login へリダイレクト
      }

      // ログイン済み & 認証ページ → ダッシュボードへ
      if (isLoggedIn && isOnAuth) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      // ログイン済み & ルート → ダッシュボードへ
      if (isLoggedIn && isOnRoot) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      // 未ログイン & ルート → そのまま表示（ランディングページ）
      return true;
    },
  },
});
