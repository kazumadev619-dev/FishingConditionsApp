import bcrypt from 'bcrypt';
import { AuthError } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from '@/auth';
import { EmailNotVerifiedError } from '@/auth/providers/credentials';
import { issueVerificationEmail } from '@/lib/email';
import { logger, maskEmail } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { isSignupRateLimited } from '@/lib/rateLimit';
import { authenticate, signup } from './actions';

vi.mock('@/auth', () => ({ signIn: vi.fn() }));
vi.mock('@/auth/providers/credentials', async () => {
  const { CredentialsSignin } = await import('next-auth');
  return { EmailNotVerifiedError: class extends CredentialsSignin {} };
});
vi.mock('@/lib/email', () => ({ issueVerificationEmail: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    users: { create: vi.fn(), deleteMany: vi.fn() },
    verification_tokens: { deleteMany: vi.fn() },
  },
}));
vi.mock('@/lib/rateLimit', () => ({ isSignupRateLimited: vi.fn() }));
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'hashed') } }));
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
  const signupForm = (password = 'Passw0rd!') => {
    const form = new FormData();
    form.set('name', 'Owner');
    form.set('email', 'Owner@Example.com');
    form.set('password', password);
    return form;
  };

  beforeEach(() => {
    vi.mocked(isSignupRateLimited).mockResolvedValue(false);
    vi.mocked(prisma.users.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.verification_tokens.deleteMany).mockResolvedValue({ count: 0 });
  });

  afterEach(() => vi.useRealTimers());

  it('登録したら確認メールを送る', async () => {
    await expect(signup(undefined, signupForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(issueVerificationEmail).toHaveBeenCalledWith('owner@example.com');
  });

  it('上限を超えたらハッシュも DB もメールも動かさず、再試行を案内する', async () => {
    vi.mocked(isSignupRateLimited).mockResolvedValue(true);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(signup(undefined, signupForm())).resolves.toBe(
      '試行回数が上限に達しました。時間をおいて再度お試しください。',
    );

    expect(isSignupRateLimited).toHaveBeenCalledWith('owner@example.com');
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.users.deleteMany).not.toHaveBeenCalled();
    expect(prisma.verification_tokens.deleteMany).not.toHaveBeenCalled();
    expect(issueVerificationEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { email: maskEmail('owner@example.com') },
      'Signup rate limit exceeded',
    );
  });

  it('入力の誤りは回数に数えない', async () => {
    await expect(signup(undefined, signupForm('short'))).resolves.toEqual(expect.any(String));

    expect(isSignupRateLimited).not.toHaveBeenCalled();
  });

  it('確認の必須化より後に作られ、7日を超えたパスワード登録の未確認の行と、期限切れのトークンを消す', async () => {
    const now = new Date('2026-12-02T00:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });

    await expect(signup(undefined, signupForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(prisma.users.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        email_verified_at: null,
        password_hash: { not: null },
        is_sso_user: false,
        identities: { none: {} },
        created_at: {
          gte: new Date('2026-11-02T06:30:00Z'),
          lt: new Date('2026-11-25T00:00:00Z'),
        },
      },
    });
    expect(prisma.verification_tokens.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { expires_at: { lt: now } },
    });
  });

  it('期限の過ぎた行を消し終えてから、同じアドレスの行を作る', async () => {
    const { promise, resolve } = Promise.withResolvers<{ count: number }>();
    vi.mocked(prisma.users.deleteMany).mockReturnValue(promise as never);

    const result = signup(undefined, signupForm());
    await vi.waitFor(() => expect(prisma.users.deleteMany).toHaveBeenCalled());
    await new Promise((settle) => setTimeout(settle));
    expect(prisma.users.create).not.toHaveBeenCalled();

    resolve({ count: 0 });
    await expect(result).rejects.toThrow('NEXT_REDIRECT');
    expect(prisma.users.create).toHaveBeenCalledOnce();
  });

  it.each([
    ['users', () => vi.mocked(prisma.users.deleteMany)],
    ['verification_tokens', () => vi.mocked(prisma.verification_tokens.deleteMany)],
  ])('%s の削除に失敗しても登録は続け、ログに残す', async (_table, deleteMany) => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const failure = new Error('db down');
    deleteMany().mockRejectedValue(failure);

    await expect(signup(undefined, signupForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(prisma.users.create).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith({ err: failure }, 'Failed to purge stale signups');
  });
});
