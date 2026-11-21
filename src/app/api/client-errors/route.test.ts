import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/auth';
import { cache } from '@/lib/cache/client';
import { CLIENT_ERROR_LIMITS } from '@/lib/clientErrors';
import { logger } from '@/lib/logger';
import { POST } from './route';

// 認証と回数の制限は実物の withUserRateLimit を通す。外へ出るのは Redis と auth() だけ
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/cache/client', () => ({ cache: { increment: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const valid = {
  source: 'dashboard-error',
  message: 'boom',
  name: 'TypeError',
  stack: 'TypeError: boom\n    at x',
  digest: 'abc123',
  path: '/dashboard',
};

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/client-errors', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1' } } as never);
  vi.mocked(cache.increment).mockResolvedValue(1);
});

describe('POST /api/client-errors（#247）', () => {
  it('ログイン中の利用者の報告を、ユーザー ID つきの error ログに1件残して 204 を返す', async () => {
    const res = await post(valid);

    expect(res.status).toBe(204);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { userId: 'user-1', clientError: valid },
      'Client-side error reported',
    );
  });

  it('未ログインは 401 で、ログに残さない', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    expect((await post(valid)).status).toBe(401);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('1 分の上限（60 件）を超えたら 429 で、ログに残さない', async () => {
    vi.mocked(cache.increment).mockResolvedValue(61);

    const res = await post(valid);

    expect(res.status).toBe(429);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('利用者 ID は本文ではなくセッションから取る（本文の userId は受け付けない）', async () => {
    const res = await post({ ...valid, userId: 'someone-else' });

    expect(res.status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON でない本文', 'not json'],
    ['配列', []],
    ['未知の source', { ...valid, source: 'other' }],
    ['message が無い', { source: 'window-error' }],
    ['message が上限超え', { ...valid, message: 'm'.repeat(CLIENT_ERROR_LIMITS.message + 1) }],
    ['stack が上限超え', { ...valid, stack: 's'.repeat(CLIENT_ERROR_LIMITS.stack + 1) }],
    ['文字列でない stack', { ...valid, stack: { a: 1 } }],
  ])('入力が不正（%s）なら 400 で、ログに残さない', async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('本文が上限（CLIENT_ERROR_LIMITS.bodyBytes）を超えたら 413 で、ログに残さない', async () => {
    const big = JSON.stringify({ ...valid, message: 'x'.repeat(CLIENT_ERROR_LIMITS.bodyBytes) });

    expect((await post(big)).status).toBe(413);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
