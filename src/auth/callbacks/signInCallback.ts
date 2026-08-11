import { randomUUID } from 'node:crypto';
import type { Account, User } from 'next-auth';
import { sendVerificationEmail } from '@/lib/email';
import { logger, maskEmail } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { createVerificationToken } from '@/lib/token';

export async function signInCallback({
  user,
  account,
}: {
  user: User;
  account?: Account | null;
}): Promise<boolean> {
  if (account?.provider === 'credentials') {
    return true;
  }

  if (account?.provider === 'google' && user.email) {
    const email = user.email.toLowerCase().trim();

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
          if (!existingUser.email_verified_at) {
            try {
              const token = await createVerificationToken(email);
              const verificationUrl = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${token}`;
              await sendVerificationEmail(email, verificationUrl, 'social-link');
              logger.info(
                { email: maskEmail(email) },
                'Verification email sent for social account linking',
              );
            } catch (error) {
              logger.error({ email: maskEmail(email), error }, 'Failed to send verification email');
            }
            return false;
          }

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

          await prisma.users.update({
            where: { id: existingUser.id },
            data: { is_sso_user: true },
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
