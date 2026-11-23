import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';

vi.mock('@/lib/cache/client', () => ({ cache: { isAvailable: () => true } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: vi.fn() } }));

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

async function loadGet() {
  vi.resetModules();
  return (await import('./route')).GET;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(prisma.$queryRaw).mockReset();
  vi.mocked(logger.warn).mockReset();
  vi.mocked(logger.error).mockReset();
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

  // 根拠: docs/reference/api-error-handling.md「エラーの分類と扱い」（異常なエラーは error ログ）
  // および #428 追記（#187 で probe から外れたため warn の理由が無くなった）
  it('DB 確認に失敗したときは error レベルで DB_ERROR を記録し、warn には出さない', async () => {
    const dbError = new Error('connection refused');
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(dbError as never);
    const GET = await loadGet();

    const response = await GET();

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      { type: 'DB_ERROR', err: dbError },
      'Readiness check failed: database is not reachable',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('DB 確認が成功したときは error ログを出さない', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    const GET = await loadGet();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
