import type { Account, Profile, User } from 'next-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { signInCallback } from './signInCallback';

const tx = vi.hoisted(() => ({
  users: { create: vi.fn(), delete: vi.fn() },
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
  existingUser: { email_verified_at: Date | null } | null,
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

  it('メール確認済みのアカウントには連携しない', async () => {
    givenDb({ email_verified_at: new Date() });

    await expect(signIn()).resolves.toBe(false);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('メール未確認の行は引き継がず、別の id で作り直す', async () => {
    givenDb({ email_verified_at: null });

    await expect(signIn()).resolves.toBe(true);

    expect(tx.users.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    const created = tx.users.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      email: 'owner@example.com',
      password_hash: null,
      email_verified_at: expect.any(Date),
    });
    expect(created.id).not.toBe('user-1');
    expect(tx.identities.create.mock.calls[0][0].data.user_id).toBe(created.id);
  });

  it('同じメールが無ければ新規登録する', async () => {
    givenDb(null);

    await expect(signIn()).resolves.toBe(true);

    expect(tx.users.delete).not.toHaveBeenCalled();
    expect(tx.users.create).toHaveBeenCalledOnce();
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
