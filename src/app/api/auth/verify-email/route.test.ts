import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { deleteVerificationToken, verifyToken } from '@/lib/token';
import * as route from './route';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  default: { users: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/token', () => ({ verifyToken: vi.fn(), deleteVerificationToken: vi.fn() }));

const post = (token?: string) =>
  route.POST(
    new NextRequest('https://app.test/api/auth/verify-email', {
      method: 'POST',
      body: new URLSearchParams(token ? { token } : {}),
    }),
  );

afterEach(() => vi.clearAllMocks());

describe('POST /api/auth/verify-email', () => {
  it('リンクを開くだけでは確定しないよう、GET と HEAD を持たない', () => {
    expect(Object.keys(route)).toEqual(['POST']);
  });

  it('有効なトークンなら確認済みにして、303 で成功ページへ送る', async () => {
    vi.mocked(verifyToken).mockResolvedValue('owner@example.com');
    vi.mocked(prisma.users.findUnique).mockResolvedValue({ id: 'user-1' } as never);

    const response = await post('token-1');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/auth/verification-success');
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { email_verified_at: expect.any(Date) },
    });
    expect(deleteVerificationToken).toHaveBeenCalledWith('token-1');
  });

  it('トークンが無いか無効なら確認済みにしない', async () => {
    vi.mocked(verifyToken).mockResolvedValue(null);

    expect((await post()).headers.get('location')).toContain('error=missing_token');
    expect((await post('bad')).headers.get('location')).toContain('error=invalid_token');
    expect(prisma.users.update).not.toHaveBeenCalled();
  });
});
