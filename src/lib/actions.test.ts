import { AuthError } from 'next-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn } from '@/auth';
import { EmailNotVerifiedError } from '@/auth/providers/credentials';
import { issueVerificationEmail } from '@/lib/email';
import { authenticate, signup } from './actions';

vi.mock('@/auth', () => ({ signIn: vi.fn() }));
vi.mock('@/auth/providers/credentials', async () => {
  const { CredentialsSignin } = await import('next-auth');
  return { EmailNotVerifiedError: class extends CredentialsSignin {} };
});
vi.mock('@/lib/email', () => ({ issueVerificationEmail: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { users: { create: vi.fn() } } }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

afterEach(() => vi.clearAllMocks());

describe('authenticate', () => {
  it('未確認ならメールの確認を案内する', async () => {
    vi.mocked(signIn).mockRejectedValue(new EmailNotVerifiedError());

    await expect(authenticate(undefined, new FormData())).resolves.toContain(
      'メールアドレスが確認できていません',
    );
  });

  it('それ以外の認証失敗は入力の誤りとして返す', async () => {
    const error = new AuthError();
    error.type = 'CredentialsSignin';
    vi.mocked(signIn).mockRejectedValue(error);

    await expect(authenticate(undefined, new FormData())).resolves.toBe(
      'メールアドレスまたはパスワードが正しくありません。',
    );
  });
});

describe('signup', () => {
  it('登録したら確認メールを送る', async () => {
    const form = new FormData();
    form.set('name', 'Owner');
    form.set('email', 'Owner@Example.com');
    form.set('password', 'Passw0rd!');

    await expect(signup(undefined, form)).rejects.toThrow('NEXT_REDIRECT');

    expect(issueVerificationEmail).toHaveBeenCalledWith('owner@example.com');
  });
});
