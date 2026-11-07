import type { Account, User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { beforeEach, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { jwtCallback } from './jwtCallback';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() }, maskEmail: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { users: { findUnique: vi.fn() } } }));

// DB には owner@example.com の行だけがある
const DB_ID = '11111111-1111-4111-8111-111111111111';
// Auth.js は DB を持たないので、OAuth のユーザーに自前の UUID を振る（users には無い id）
const AUTHJS_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.mocked(prisma.users.findUnique).mockImplementation((async (args: {
    where: { email?: string };
  }) => (args.where.email === 'owner@example.com' ? { id: DB_ID } : null)) as never);
});

it('Google のログインでは DB の id をトークンに入れる', async () => {
  const token = await jwtCallback({
    token: {} as JWT,
    user: { id: AUTHJS_ID, email: 'Owner@Example.com' } as User,
    account: { provider: 'google' } as Account,
  });

  expect(token.id).toBe(DB_ID);
});

// 守る状態: users に無い id をセッションに載せない（お気に入りの登録が外部キー違反になる。#69 の c67273b）
it('Google のログインで DB に行が無ければ、Auth.js の id をトークンに入れない', async () => {
  const token = await jwtCallback({
    token: {} as JWT,
    user: { id: AUTHJS_ID, email: 'stranger@example.com' } as User,
    account: { provider: 'google' } as Account,
  });

  expect(token.id).not.toBe(AUTHJS_ID);
});

// 守る状態: パスワードのログインでも、セッションに users の id が載る。
// 期待値: docs/reference/authentication-diagrams.md のログインの図（token.id = user.id。user は authorize が返した users の行）
it('メールとパスワードのログインでは、authorize が返したユーザーの id とメールをトークンに入れる', async () => {
  const token = await jwtCallback({
    token: {} as JWT,
    user: { id: DB_ID, email: 'owner@example.com' } as User,
    account: { provider: 'credentials' } as Account,
  });

  expect(token).toMatchObject({ id: DB_ID, email: 'owner@example.com' });
});

// 守る状態: UUID でない id を持つ古いトークンは、メールで users の id に引き直す（#69 の c67273b、#2 の 5d6f391）
it('UUID でない id のトークンは、メールで DB の id に直す', async () => {
  const token = await jwtCallback({
    token: { email: 'Owner@Example.com', id: 'legacy-id' } as JWT,
  });

  expect(token.id).toBe(DB_ID);
});
