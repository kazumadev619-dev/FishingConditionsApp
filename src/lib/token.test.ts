import { describe, expect, it, vi } from 'vitest';
import prisma from './prisma';
import { hasActiveVerificationToken } from './token';

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() }, maskEmail: vi.fn() }));
vi.mock('./prisma', () => ({ default: { verification_tokens: { count: vi.fn() } } }));

describe('hasActiveVerificationToken', () => {
  it('期限内のトークンだけを数える', async () => {
    vi.mocked(prisma.verification_tokens.count).mockResolvedValue(0);

    await expect(hasActiveVerificationToken('owner@example.com')).resolves.toBe(false);

    expect(prisma.verification_tokens.count).toHaveBeenCalledWith({
      where: { email: 'owner@example.com', expires_at: { gt: expect.any(Date) } },
    });
  });
});
