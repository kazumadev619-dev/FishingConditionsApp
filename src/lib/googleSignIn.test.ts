import { signIn } from 'next-auth/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { GOOGLE_SIGN_IN_ERROR, signInWithGoogle } from './googleSignIn';

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe('signInWithGoogle', () => {
  it('失敗したら例外をログに残し、利用者には内部の文言を出さない', async () => {
    const cause = new Error('MissingCSRF: internal detail');
    vi.mocked(signIn).mockRejectedValueOnce(cause);
    const setError = vi.fn();

    await signInWithGoogle(setError);

    expect(logger.error).toHaveBeenCalledWith({ err: cause }, expect.any(String));
    expect(setError).toHaveBeenLastCalledWith(GOOGLE_SIGN_IN_ERROR);
    expect(GOOGLE_SIGN_IN_ERROR).not.toContain('internal detail');
  });

  it('成功したらエラーを消すだけでログは出さない', async () => {
    // redirect 既定の signIn は成功するとページ遷移するだけなので、戻り値は見ない
    const setError = vi.fn();

    await signInWithGoogle(setError);

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
    expect(setError).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
