import bcrypt from 'bcrypt';
import { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { issueVerificationEmail } from '@/lib/email';
import { logger, maskEmail } from '@/lib/logger';
import { hasActiveVerificationToken } from '@/lib/token';
import { getUser } from '../utils/userRepository';

export class EmailNotVerifiedError extends CredentialsSignin {
  code = 'email_not_verified';
}

/** 有効なトークンがある間は送らない。ログインのたびに同じ宛先へメールが飛ばないように */
async function resendVerificationEmail(email: string): Promise<void> {
  try {
    if (await hasActiveVerificationToken(email)) {
      return;
    }
    await issueVerificationEmail(email);
  } catch (error) {
    logger.error({ email: maskEmail(email), error }, 'Failed to resend verification email');
  }
}

export const credentialsProvider = Credentials({
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
      logger.warn(
        { email: maskEmail(email) },
        'User authentication failed: user not found or password hash missing',
      );
      return null;
    }

    const passwordsMatch = await bcrypt.compare(password, user.password_hash);

    if (passwordsMatch) {
      if (!user.email_verified_at) {
        await resendVerificationEmail(user.email);
        throw new EmailNotVerifiedError();
      }
      return user;
    }

    logger.warn({ email: maskEmail(email) }, 'User authentication failed: invalid credentials');
    return null;
  },
});
