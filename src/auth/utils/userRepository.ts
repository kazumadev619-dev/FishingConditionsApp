import { logger, maskEmail } from '@/lib/logger';
import prisma from '@/lib/prisma';

export async function getUser(email: string) {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.users.findUnique({
      where: { email: normalizedEmail },
    });
    return user;
  } catch (error) {
    logger.error({ email: maskEmail(email), error }, 'Failed to fetch user from database');
    return null;
  }
}
