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
    // メールアドレスを正規化（新規登録時と同じ処理）
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.users.findUnique({
      where: {
        email: normalizedEmail,
      },
    });
    return user;
  } catch (error) {
    console.error('Failed to fetch user:', error);
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
        if (!user || !user.password_hash) {
          console.log('User not found or password hash missing.');
          return null;
        }

        const passwordsMatch = await bcrypt.compare(password, user.password_hash);

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
          const existingUser = await prisma.users.findUnique({
            where: { email },
          });

          if (existingUser) {
            // 既存ユーザーが存在する場合：アカウント連携
            const existingIdentity = await prisma.identities.findUnique({
              where: {
                provider_provider_id: {
                  provider: 'google',
                  provider_id: account.providerAccountId,
                },
              },
            });

            if (!existingIdentity) {
              // identitiesレコードを作成（アカウント連携）
              await prisma.identities.create({
                data: {
                  provider: 'google',
                  provider_id: account.providerAccountId,
                  user_id: existingUser.id,
                  identity_data: {
                    email: user.email,
                    name: user.name,
                    picture: user.image,
                  },
                  last_sign_in_at: new Date(),
                },
              });

              // is_sso_userフラグを更新
              await prisma.users.update({
                where: { id: existingUser.id },
                data: { is_sso_user: true },
              });
            }

            return true;
          } else {
            // 新規ユーザー作成
            const userId = randomUUID();

            await prisma.$transaction(async (tx) => {
              // usersレコード作成（認証+プロフィール統合）
              await tx.users.create({
                data: {
                  id: userId,
                  email,
                  password_hash: null,
                  name: user.name || 'Googleユーザー',
                  avatar_url: user.image,
                  is_sso_user: true,
                  email_verified_at: new Date(),
                },
              });

              // identitiesレコード作成
              await tx.identities.create({
                data: {
                  provider: 'google',
                  provider_id: account.providerAccountId,
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
          return false;
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
