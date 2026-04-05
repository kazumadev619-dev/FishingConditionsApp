import NextAuth from 'next-auth';
import { baseAuthConfig } from './config';
import { jwtCallback } from './callbacks/jwtCallback';
import { sessionCallback } from './callbacks/sessionCallback';
import { signInCallback } from './callbacks/signInCallback';
import { credentialsProvider } from './providers/credentials';
import { googleProvider } from './providers/google';

/**
 * Node Runtime用の認証設定
 * API Routes、Server Componentsで使用（Prisma利用可能）
 */

// 環境変数の検証（起動時）
if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
  throw new Error('AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must be set in environment variables');
}

if (!process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be set in environment variables');
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...baseAuthConfig,
  providers: [googleProvider, credentialsProvider],
  callbacks: {
    ...baseAuthConfig.callbacks,
    signIn: signInCallback,
    jwt: jwtCallback,
    session: sessionCallback,
  },
});
