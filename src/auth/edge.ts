import NextAuth from 'next-auth';
import { authConfig } from './config';

/**
 * Edge Runtime用の認証設定
 * middlewareで使用（Prisma/Adapterなし、JWTセッションのみ）
 */
export const { auth, handlers } = NextAuth(authConfig);
