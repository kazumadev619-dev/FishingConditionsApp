import type { Account, User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { jwtCallback } from './jwtCallback';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() }, maskEmail: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { users: { findUnique: vi.fn() } } }));

it('Google のログインでは DB の id をトークンに入れる', async () => {
  vi.mocked(prisma.users.findUnique).mockResolvedValue({ id: 'db-id' } as never);

  const token = await jwtCallback({
    token: {} as JWT,
    user: { id: 'authjs-random-id', email: 'Owner@Example.com' } as User,
    account: { provider: 'google' } as Account,
  });

  expect(token.id).toBe('db-id');
  expect(prisma.users.findUnique).toHaveBeenCalledWith({
    where: { email: 'owner@example.com' },
    select: { id: true },
  });
});
