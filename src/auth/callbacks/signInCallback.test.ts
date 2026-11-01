import type { Account, Profile, User } from 'next-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { signInCallback } from './signInCallback';

const tx = vi.hoisted(() => ({
  users: { create: vi.fn(), update: vi.fn() },
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

const signInWithExistingUser = (existing: { email_verified_at: Date | null }) => {
  vi.mocked(prisma.users.findUnique).mockResolvedValue({ id: 'user-1', ...existing } as never);
  vi.mocked(prisma.identities.findUnique).mockResolvedValue(null);
  return signInCallback({ user, account, profile: verifiedProfile });
};

afterEach(() => vi.clearAllMocks());

describe('signInCallback の Google ログイン', () => {
  it('メール未確認の既存アカウントに連携すると、パスワードを捨てて確認済みにする', async () => {
    await expect(signInWithExistingUser({ email_verified_at: null })).resolves.toBe(true);

    expect(tx.identities.create).toHaveBeenCalledOnce();
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { is_sso_user: true, email_verified_at: expect.any(Date), password_hash: null },
    });
  });

  it('メール確認済みの既存アカウントのパスワードは残す', async () => {
    const verifiedAt = new Date('2026-01-01T00:00:00Z');

    await expect(signInWithExistingUser({ email_verified_at: verifiedAt })).resolves.toBe(true);

    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { is_sso_user: true },
    });
  });

  it('Google が確認していないメールは拒否し、DB を読まない', async () => {
    const result = await signInCallback({
      user,
      account,
      profile: { email_verified: false } as Profile,
    });

    expect(result).toBe(false);
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });
});
