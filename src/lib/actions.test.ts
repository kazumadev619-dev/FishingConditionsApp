import bcrypt from 'bcrypt';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from '@/auth';
import { EmailNotVerifiedError } from '@/auth/providers/credentials';
import { issueVerificationEmail } from '@/lib/email';
import { logger } from '@/lib/logger';
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
vi.mock('bcrypt', async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof import('bcrypt') }>()).default;
  return { default: { ...real, hash: vi.fn(real.hash) } };
});
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  }),
}));

afterEach(() => vi.clearAllMocks());

describe('authenticate', () => {
  // 守る状態: ログインに成功したら遷移する。next-auth の signIn は成功すると、redirect コールバックの
  // 遷移先（src/auth/config.ts の /dashboard）へ redirect() の例外を投げて遷移する。それを握りつぶさない。
  // 期待値: docs/reference/authentication.md「2. ログイン」の4（成功すると /dashboard へ）
  it('ログインに成功したら、ダッシュボードへ遷移する', async () => {
    vi.mocked(signIn).mockImplementation(async () => redirect('http://localhost:3000/dashboard'));

    await expect(authenticate(undefined, new FormData())).rejects.toMatchObject({
      url: 'http://localhost:3000/dashboard',
    });
  });

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
    vi.mocked(issueVerificationEmail).mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  it('登録したら確認メールを送る', async () => {
    await expect(signup(undefined, signupForm())).rejects.toMatchObject({
      url: '/auth/check-email',
    });

    expect(issueVerificationEmail).toHaveBeenCalledWith('owner@example.com');
  });

  it('送れたら、確認メールのページへ進む', async () => {
    await expect(signup(undefined, signupForm())).rejects.toMatchObject({
      url: '/auth/check-email',
    });
  });

  // 守る状態: 登録しただけでは確認済みにならず、パスワードはハッシュで保存する。
  // 期待値: docs/reference/authentication.md「1. ユーザー登録」の3（bcrypt でハッシュ化、email_verified_at は NULL）
  it('未確認のまま、パスワードのハッシュを保存する', async () => {
    await expect(signup(undefined, signupForm())).rejects.toMatchObject({
      url: '/auth/check-email',
    });

    const { data } = vi.mocked(prisma.users.create).mock.calls[0][0];
    expect(data.email_verified_at ?? null).toBeNull();
    await expect(bcrypt.compare('Passw0rd!', data.password_hash as string)).resolves.toBe(true);
  });

  it.each([
    ['false を返したとき', () => vi.mocked(issueVerificationEmail).mockResolvedValue(false)],
    [
      '例外を投げたとき',
      () => vi.mocked(issueVerificationEmail).mockRejectedValue(new Error('smtp')),
    ],
  ])(
    'メールの送信が%s、送れなかったことを伝えるページへ進む（登録は残す）',
    async (_case, arrange) => {
      vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      arrange();

      await expect(signup(undefined, signupForm())).rejects.toMatchObject({
        url: '/auth/check-email?sent=0',
      });

      expect(prisma.users.create).toHaveBeenCalled();
    },
  );

  it('DB への登録に失敗したら、遷移せずエラーを返し、確認メールも送らない', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.mocked(prisma.users.create).mockRejectedValueOnce(new Error('db down'));

    await expect(signup(undefined, signupForm())).resolves.toBe(
      'ユーザーの作成に失敗しました。時間をおいて再度お試しください。',
    );

    expect(redirect).not.toHaveBeenCalled();
    expect(issueVerificationEmail).not.toHaveBeenCalled();
  });

  it('上限を超えたらハッシュも DB もメールも動かさず、再試行を案内する', async () => {
    vi.mocked(isSignupRateLimited).mockResolvedValue(true);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(signup(undefined, signupForm())).resolves.toBe(
      '試行回数が上限に達しました。時間をおいて再度お試しください。',
    );

    expect(isSignupRateLimited).toHaveBeenCalledWith('owner@example.com');
    expect(redirect).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.users.deleteMany).not.toHaveBeenCalled();
    expect(prisma.verification_tokens.deleteMany).not.toHaveBeenCalled();
    expect(issueVerificationEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith({ email: 'ow***@example.com' }, 'Signup rate limit exceeded');
  });

  it('入力の誤りは回数に数えない', async () => {
    await expect(signup(undefined, signupForm('short'))).resolves.toEqual(expect.any(String));

    expect(isSignupRateLimited).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('確認の必須化より後に作られ、7日を超えたパスワード登録の未確認の行と、期限切れのトークンを消す', async () => {
    const now = new Date('2026-12-02T00:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });

    await expect(signup(undefined, signupForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(prisma.users.deleteMany).toHaveBeenCalledWith({
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
    expect(prisma.verification_tokens.deleteMany).toHaveBeenCalledWith({
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
    expect(prisma.users.create).toHaveBeenCalled();
  });

  it.each([
    ['users', () => vi.mocked(prisma.users.deleteMany)],
    ['verification_tokens', () => vi.mocked(prisma.verification_tokens.deleteMany)],
  ])('%s の削除に失敗しても登録は続け、ログに残す', async (_table, deleteMany) => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const failure = new Error('db down');
    deleteMany().mockRejectedValue(failure);

    await expect(signup(undefined, signupForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(prisma.users.create).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({ err: failure }, 'Failed to purge stale signups');
  });
});
