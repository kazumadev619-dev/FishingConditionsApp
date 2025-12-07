import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { authConfig } from './auth.config';
import { randomUUID } from 'crypto';

async function getUser(email: string) {
  try {
    const user = await prisma.auth_users.findUnique({
      where: {
        email: email,
      },
    });
    return user;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    // ユーザーが見つからない場合や、エラーが発生した場合は null を返す
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(8) })
          .safeParse(credentials);

        if (!parsedCredentials.success) {
          return null;
        }

        const { email, password } = parsedCredentials.data;
        const user = await getUser(email);
        if (!user || !user.encrypted_password) {
          console.log('User not found or password hash missing.');
          return null;
        }

        const passwordsMatch = await bcrypt.compare(password, user.encrypted_password);

        if (passwordsMatch) {
          return user;
        }

        console.log('Invalid credentials');
        return null;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Credentials認証の場合はスキップ（既存動作維持）
      if (account?.provider === 'credentials') {
        return true;
      }

      // Google認証の場合のみ処理
      if (account?.provider === 'google' && user.email) {
        const email = user.email.toLowerCase().trim();

        try {
          // 既存ユーザーをメールアドレスで検索
          const existingAuthUser = await prisma.auth_users.findUnique({
            where: { email },
          });

          if (existingAuthUser) {
            // 既存ユーザーが存在する場合：アカウント連携
            // identitiesレコードが存在するか確認
            const existingIdentity = await prisma.identities.findUnique({
              where: {
                provider_id_provider: {
                  provider_id: account.providerAccountId,
                  provider: 'google',
                },
              },
            });

            if (!existingIdentity) {
              // identitiesレコードを作成（アカウント連携）
              await prisma.identities.create({
                data: {
                  provider_id: account.providerAccountId,
                  provider: 'google',
                  user_id: existingAuthUser.id,
                  identity_data: {
                    email: user.email,
                    name: user.name,
                    picture: user.image,
                  },
                  last_sign_in_at: new Date(),
                },
              });

              // is_sso_userフラグを更新
              await prisma.auth_users.update({
                where: { id: existingAuthUser.id },
                data: { is_sso_user: true },
              });
            }

            return true;
          } else {
            // 新規ユーザー作成（トランザクション処理）
            const userId = randomUUID();

            await prisma.$transaction(async (tx) => {
              // 1. auth_usersレコード作成
              await tx.auth_users.create({
                data: {
                  id: userId,
                  email,
                  encrypted_password: null, // パスワード不要
                  aud: 'authenticated',
                  role: 'authenticated',
                  is_sso_user: true,
                  email_confirmed_at: new Date(), // OAuth認証済みなのでメール確認不要
                },
              });

              // 2. public_usersレコード作成
              await tx.public_users.create({
                data: {
                  id: userId,
                  name: user.name || 'Googleユーザー',
                  email,
                },
              });

              // 3. identitiesレコード作成
              await tx.identities.create({
                data: {
                  provider_id: account.providerAccountId,
                  provider: 'google',
                  user_id: userId,
                  identity_data: {
                    email: user.email,
                    name: user.name,
                    picture: user.image,
                  },
                  last_sign_in_at: new Date(),
                },
              });
            });

            return true;
          }
        } catch (error) {
          console.error('Google sign-in error:', error);
          return false; // ログイン失敗
        }
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
