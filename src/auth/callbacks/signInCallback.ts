import { randomUUID } from 'node:crypto';
import type { Account, Profile, User } from 'next-auth';
import { logger, maskEmail } from '@/lib/logger';
import prisma from '@/lib/prisma';

export async function signInCallback({
  user,
  account,
  profile,
}: {
  user: User;
  account?: Account | null;
  profile?: Profile;
}): Promise<boolean> {
  if (account?.provider === 'credentials') {
    return true;
  }

  if (account?.provider === 'google' && user.email) {
    const email = user.email.toLowerCase().trim();

    // OIDC では真偽値だが、文字列で届く実装もある。どちらも受け付ける
    if (String(profile?.email_verified) !== 'true') {
      logger.warn({ email: maskEmail(email) }, 'Google sign-in rejected: email is not verified');
      return false;
    }

    try {
      const existingUser = await prisma.users.findUnique({ where: { email } });
      const existingIdentity = await prisma.identities.findUnique({
        where: {
          provider_provider_id: {
            provider: 'google',
            provider_id: account.providerAccountId,
          },
        },
      });

      if (existingIdentity) {
        return existingIdentity.user_id === existingUser?.id;
      }

      // メールの一致だけでは連携しない。Google が保証できないアドレスがあるうえ、
      // 登録者がメールの持ち主とは限らない
      if (existingUser?.email_verified_at) {
        logger.warn(
          { email: maskEmail(email) },
          'Google sign-in rejected: email belongs to a verified account',
        );
        return false;
      }

      const userId = randomUUID();

      await prisma.$transaction(async (tx) => {
        // 未確認の行は持ち主のものと限らないので引き継がない。id を変えることで、
        // 確認前に発行されたセッションからも切り離す
        // 読んだ後に確認が済んだ行は消さない
        if (existingUser) {
          const { count } = await tx.users.deleteMany({
            where: { id: existingUser.id, email_verified_at: null },
          });
          if (count === 0) {
            throw new Error('User was verified during Google sign-in');
          }
        }

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
    } catch (error) {
      logger.error({ email: maskEmail(email), error }, 'Google sign-in error');
      return false;
    }
  }

  return true;
}
