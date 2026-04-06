import type { Account, User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { logger, maskEmail } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { isValidUUID } from '@/lib/validators';

export async function jwtCallback({
  token,
  user,
  account,
}: {
  token: JWT;
  user?: User;
  account?: Account | null;
}): Promise<JWT> {
  if (user && account) {
    token.email = user.email;
    if (account.provider === 'google') {
      const dbUser = await prisma.users.findUnique({
        where: { email: user.email?.toLowerCase().trim() },
        select: { id: true },
      });
      if (dbUser) {
        token.id = dbUser.id;
      } else {
        logger.error(
          { email: user.email ? maskEmail(user.email) : 'unknown' },
          'JWT callback: User not found in DB after Google sign-in',
        );
        token.id = '';
      }
    } else {
      token.id = user.id;
    }
  } else if (token.email && token.id) {
    const tokenId = token.id as string;
    if (!isValidUUID(tokenId)) {
      const dbUser = await prisma.users.findUnique({
        where: { email: (token.email as string).toLowerCase().trim() },
        select: { id: true },
      });
      if (dbUser) {
        token.id = dbUser.id;
      }
    }
  }
  return token;
}
