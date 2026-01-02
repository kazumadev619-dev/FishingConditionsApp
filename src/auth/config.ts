import type { NextAuthConfig } from 'next-auth';

/**
 * Auth.js基本設定
 * Edge/Node Runtime共通で使用
 * ❌ Prisma Adapter、DB操作callbacks含まない
 * ❌ authorized callback（Edge専用なのでedge.tsに配置）
 * ✅ session戦略、pages、runtime非依存callbacks のみ
 */
export const baseAuthConfig = {
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
  },
} satisfies NextAuthConfig;
