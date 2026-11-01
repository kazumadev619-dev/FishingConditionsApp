import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('@/lib/cache', () => ({ cache: { isAvailable: () => true } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: vi.fn() } }));

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

async function loadGet() {
  vi.resetModules();
  return (await import('./route')).GET;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(prisma.$queryRaw).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('GET /readyz', () => {
  it('成功は30分のあいだ覚え、DB を叩かない', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    const GET = await loadGet();
    const checkedAt = new Date().toISOString();

    expect((await GET()).status).toBe(200);
    vi.advanceTimersByTime(THIRTY_MINUTES_MS - 1);
    const response = await GET();

    expect(response.status).toBe(200);
    const { checks } = await response.json();
    expect(checks.database).toBe('ok');
    expect(checks.databaseCheckedAt).toBe(checkedAt);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('30分を過ぎたら DB を見直す', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    const GET = await loadGet();

    await GET();
    vi.advanceTimersByTime(THIRTY_MINUTES_MS);
    await GET();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('期限が切れて確認に失敗したら、古い成功時刻を返さない', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('down') as never);
    const GET = await loadGet();

    await GET();
    vi.advanceTimersByTime(THIRTY_MINUTES_MS);
    const failed = await GET();

    expect(failed.status).toBe(503);
    expect((await failed.json()).checks.databaseCheckedAt).toBeNull();
  });

  it('失敗は覚えず、次のリクエストで回復が見える', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('down') as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);
    const GET = await loadGet();

    const failed = await GET();
    expect(failed.status).toBe(503);
    expect((await failed.json()).checks.databaseCheckedAt).toBeNull();
    expect((await GET()).status).toBe(200);
  });
});
