import { signIn } from 'next-auth/react';
import { logger } from '@/lib/logger';

export const GOOGLE_SIGN_IN_ERROR =
  'Googleログインに失敗しました。時間をおいて再度お試しください。';

/** login / register 共通。失敗の原因はログに残し、利用者には固定の文言だけを出す */
export async function signInWithGoogle(setError: (message: string | undefined) => void) {
  try {
    setError(undefined);
    await signIn('google', { callbackUrl: '/dashboard' });
  } catch (err) {
    logger.error({ err }, 'Google sign-in failed');
    setError(GOOGLE_SIGN_IN_ERROR);
  }
}
