import { NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/auth';
import { cache } from '@/lib/cache';
import { isRateLimited, withUserRateLimit } from './rateLimit';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/cache', () => ({ cache: { increment: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

const handler = vi.fn(async () => NextResponse.json({ ok: true }));

afterEach(() => vi.clearAllMocks());

describe('isRateLimited', () => {
  it.each([
    [3, false],
    [4, true],
  ])('上限3でカウントが %i なら %s', async (count, limited) => {
    vi.mocked(cache.increment).mockResolvedValue(count);

    await expect(isRateLimited('k', 3, 60)).resolves.toBe(limited);
    expect(cache.increment).toHaveBeenCalledWith('ratelimit:k', 60);
  });

  it('Redis が使えないときは制限しない', async () => {
    vi.mocked(cache.increment).mockResolvedValue(null);

    await expect(isRateLimited('k', 3, 60)).resolves.toBe(false);
  });
});

describe('withUserRateLimit', () => {
  const asUser = (id: string) => vi.mocked(auth).mockResolvedValue({ user: { id } } as never);

  it('上限を超えたら 429 と Retry-After を返し、ハンドラを呼ばない', async () => {
    asUser('user-1');
    vi.mocked(cache.increment).mockResolvedValue(61);

    const response = await withUserRateLimit('weather', handler);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(handler).not.toHaveBeenCalled();
  });

  it('上限ちょうどまでは通し、ルートとユーザーごとに数える', async () => {
    asUser('user-1');
    vi.mocked(cache.increment).mockResolvedValue(60);

    const response = await withUserRateLimit('weather', handler);

    expect(response.status).toBe(200);
    expect(cache.increment).toHaveBeenCalledWith('ratelimit:weather:user-1', 60);
  });
});
