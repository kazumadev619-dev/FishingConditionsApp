import type { Account, Profile, User } from 'next-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { signInCallback } from './signInCallback';

const tx = vi.hoisted(() => ({
  users: { create: vi.fn(), deleteMany: vi.fn(async () => ({ count: 1 })) },
  identities: { create: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    users: { findUnique: vi.fn() },
    identities: { findUnique: vi.fn() },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
  },
}));

const user = { email: 'Owner@Example.com', name: 'Owner', image: null } as User;
const account = { provider: 'google', providerAccountId: 'google-1' } as Account;
const verifiedProfile = { email_verified: true } as Profile;

const givenDb = (
  existingUser: { email_verified_at: Date | null; password_hash?: string } | null,
  identityUserId: string | null = null,
) => {
  vi.mocked(prisma.users.findUnique).mockResolvedValue(
    (existingUser && { id: 'user-1', ...existingUser }) as never,
  );
  vi.mocked(prisma.identities.findUnique).mockResolvedValue(
    (identityUserId && { user_id: identityUserId }) as never,
  );
};
const signIn = (profile?: Profile) =>
  signInCallback({ user, account, profile: profile ?? verifiedProfile });

afterEach(() => vi.clearAllMocks());

describe('signInCallback の Google ログイン', () => {
  it('連携済みの Google アカウントはそのままログインでき、書き込まない', async () => {
    givenDb({ email_verified_at: new Date() }, 'user-1');

    await expect(signIn()).resolves.toBe(true);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('別のユーザーに紐づく Google アカウントは、メールが同じでも拒否する', async () => {
    givenDb({ email_verified_at: new Date() }, 'other-user');

    await expect(signIn()).resolves.toBe(false);
  });

  it('連携済みでも、同じメールの行が無ければ拒否する', async () => {
    givenDb(null, 'user-1');

    await expect(signIn()).resolves.toBe(false);
  });

  it('メール確認済みのアカウントには連携しない', async () => {
    givenDb({ email_verified_at: new Date() });

    await expect(signIn()).resolves.toBe(false);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('メール未確認の行は引き継がず、別の id で作り直す', async () => {
    givenDb({ email_verified_at: null, password_hash: 'unverified-hash' });

    await expect(signIn()).resolves.toBe(true);

    expect(tx.users.deleteMany).toHaveBeenCalledWith({
      where: { id: 'user-1', email_verified_at: null },
    });
    expect(tx.users.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.users.create.mock.invocationCallOrder[0],
    );
    const created = tx.users.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      email: 'owner@example.com',
      password_hash: null,
      email_verified_at: expect.any(Date),
    });
    expect(created.id).not.toBe('user-1');
    expect(tx.identities.create.mock.calls[0][0].data).toMatchObject({
      provider: 'google',
      provider_id: 'google-1',
      user_id: created.id,
    });
  });

  it('読んだ後に確認が済んだ行は消さず、作り直しもしない', async () => {
    givenDb({ email_verified_at: null });
    tx.users.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(signIn()).resolves.toBe(false);

    expect(tx.users.create).not.toHaveBeenCalled();
  });

  it('DB の例外では拒否する', async () => {
    vi.mocked(prisma.users.findUnique).mockRejectedValue(new Error('db down'));

    await expect(signIn()).resolves.toBe(false);
  });

  it('同じメールが無ければ新規登録する', async () => {
    givenDb(null);

    await expect(signIn()).resolves.toBe(true);

    expect(tx.users.deleteMany).not.toHaveBeenCalled();
    expect(tx.users.create.mock.calls[0][0].data).toMatchObject({
      name: 'Owner',
      is_sso_user: true,
    });
  });

  it('email_verified は文字列の true でも受け付ける', async () => {
    givenDb(null);

    await expect(signIn({ email_verified: 'true' } as unknown as Profile)).resolves.toBe(true);
  });

  it.each([{ email_verified: false }, { email_verified: 'false' }, {}])(
    'Google が確認していないメールは拒否し、DB を読まない: %j',
    async (profile) => {
      await expect(signIn(profile as Profile)).resolves.toBe(false);

      expect(prisma.users.findUnique).not.toHaveBeenCalled();
    },
  );
});

describe('signInCallback のメールとパスワードのログイン', () => {
  // 守る状態: authorize が通したユーザーを、ここで拒否しない（拒否すると全員ログインできない）。
  // 期待値: docs/reference/authentication.md「2. ログイン」（authorize が返せばセッションを作る）
  it('authorize が通したユーザーはログインできる', async () => {
    await expect(
      signInCallback({
        user: { id: 'user-1', email: 'owner@example.com' } as User,
        account: { provider: 'credentials', type: 'credentials' } as Account,
      }),
    ).resolves.toBe(true);
  });
});
