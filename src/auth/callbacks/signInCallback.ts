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

    if (profile?.email_verified !== true) {
      logger.warn({ email: maskEmail(email) }, 'Google sign-in rejected: email is not verified');
      return false;
    }

    try {
      const existingUser = await prisma.users.findUnique({ where: { email } });

      if (existingUser) {
        const existingIdentity = await prisma.identities.findUnique({
          where: {
            provider_provider_id: {
              provider: 'google',
              provider_id: account.providerAccountId,
            },
          },
        });

        if (!existingIdentity) {
          // Google が確認したメールなので、持ち主の証明はここで済んでいる。
          // 確認前に登録されたパスワードは持ち主のものと限らないので引き継がない
          const verifiedNow = existingUser.email_verified_at
            ? {}
            : { email_verified_at: new Date(), password_hash: null };

          await prisma.$transaction(async (tx) => {
            await tx.identities.create({
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

            await tx.users.update({
              where: { id: existingUser.id },
              data: { is_sso_user: true, ...verifiedNow },
            });
          });
        }

        return true;
      } else {
        const userId = randomUUID();

        await prisma.$transaction(async (tx) => {
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
      }
    } catch (error) {
      logger.error({ email: maskEmail(email), error }, 'Google sign-in error');
      return false;
    }
  }

  return true;
}
