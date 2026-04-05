import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/validators';

export async function sessionCallback({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Promise<Session> {
  if (session.user) {
    const tokenId = token.id as string;
    if (isValidUUID(tokenId)) {
      session.user.id = tokenId;
    } else {
      logger.error({ tokenId }, 'Session callback: Invalid user ID in token');
      session.user.id = '';
    }
  }
  return session;
}
