import type { NextAuthConfig } from 'next-auth';

/**
 * Auth.js共通設定
 * Edge RuntimeとNode Runtimeの両方で使用可能
 * Prisma/Adapterへの依存なし
 */
export const authConfig = {
  // JWTセッション戦略（Edge Runtime対応）
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7日間
    updateAge: 24 * 60 * 60, // 24時間ごとにトークンを更新
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    // auth/index.tsでCredentials/Googleプロバイダーを追加
  ],
  callbacks: {
    async redirect({ baseUrl }) {
      return `${baseUrl}/dashboard`;
    },
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
} satisfies NextAuthConfig;
