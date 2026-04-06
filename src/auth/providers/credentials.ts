import bcrypt from 'bcrypt';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { logger, maskEmail } from '@/lib/logger';
import { getUser } from '../utils/userRepository';

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
      return user;
    }

    logger.warn({ email: maskEmail(email) }, 'User authentication failed: invalid credentials');
    return null;
  },
});
