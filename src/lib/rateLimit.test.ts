import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/auth';
import { cache } from '@/lib/cache/client';
import { logger } from '@/lib/logger';
import {
  isRateLimited,
  isSignupRateLimited,
  isUserRateLimited,
  withUserRateLimit,
} from './rateLimit';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/cache/client', () => ({ cache: { increment: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

const handler = vi.fn(async (userId: string) => NextResponse.json({ ok: true, userId }));

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

const asUser = (id: string) => vi.mocked(auth).mockResolvedValue({ user: { id } } as never);

describe('isUserRateLimited', () => {
  it('ユーザーと経路ごとに数える', async () => {
    asUser('user-1');
    vi.mocked(cache.increment).mockResolvedValue(61);

    await expect(isUserRateLimited('dashboard')).resolves.toBe(true);
    expect(cache.increment).toHaveBeenCalledWith('ratelimit:dashboard:user-1', 60);
  });

  // 仕様（#472）: 空文字・空白のみ・非文字列の user.id は未認証と同じく遮断し、Redis 計数を行わない
  it.each([
    ['null', null],
    ['空オブジェクト', {}],
    ['user.id が無い', { user: {} }],
    ['user.id が空文字', { user: { id: '' } }],
    ['user.id が半角スペースのみ', { user: { id: '   ' } }],
    ['user.id がタブ・改行のみ', { user: { id: '\t\n' } }],
    ['user.id が数値', { user: { id: 123 } }],
    ['user.id が数値 0', { user: { id: 0 } }],
    ['user.id がオブジェクト', { user: { id: { bad: true } } }],
    ['user.id が配列', { user: { id: ['user-1'] } }],
    ['user.id が真偽値 true', { user: { id: true } }],
  ])('無効セッション（%s）なら数えられないので遮断する（#472）', async (_label, session) => {
    vi.mocked(auth).mockResolvedValue(session as never);

    await expect(isUserRateLimited('dashboard')).resolves.toBe(true);
    expect(cache.increment).not.toHaveBeenCalled();
  });
});

describe('withUserRateLimit', () => {
  // 仕様（#472）: 空文字・空白のみ・非文字列の user.id は未認証と同じく 401 を返し、計数・ハンドラ・warn ログを呼ばない
  it.each([
    ['null', null],
    ['空オブジェクト', {}],
    ['user.id が無い', { user: {} }],
    ['user.id が空文字', { user: { id: '' } }],
    ['user.id が半角スペースのみ', { user: { id: '   ' } }],
    ['user.id がタブ・改行のみ', { user: { id: '\t\n' } }],
    ['user.id が数値', { user: { id: 123 } }],
    ['user.id が数値 0', { user: { id: 0 } }],
    ['user.id がオブジェクト', { user: { id: { bad: true } } }],
    ['user.id が配列', { user: { id: ['user-1'] } }],
    ['user.id が真偽値 true', { user: { id: true } }],
  ])(
    '無効セッション（%s）なら 401 を返し、回数確認・ハンドラ・warn ログを呼ばない',
    async (_label, session) => {
      vi.mocked(auth).mockResolvedValue(session as never);

      const response = await withUserRateLimit('weather', handler);

      expect(response.status).toBe(401);
      expect(cache.increment).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    },
  );

  it('上限を超えたら 429 と Retry-After を返し、warn ログを1回残してハンドラを呼ばない', async () => {
    asUser('user-1');
    vi.mocked(cache.increment).mockResolvedValue(61);

    const response = await withUserRateLimit('weather', handler);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    // 仕様: docs/reference/api-error-handling.md「エラーの分類と扱い」の表。回数制限は warn を出す。
    // ログの項目や文言は仕様にないので検証しない（1回の 429 につき 1 回、だけを確かめる）
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('上限ちょうどまでは通し、ルートとユーザーごとに数えて userId をハンドラへ渡す（#435）', async () => {
    asUser('user-1');
    vi.mocked(cache.increment).mockResolvedValue(60);

    const response = await withUserRateLimit('weather', handler);

    expect(response.status).toBe(200);
    expect(cache.increment).toHaveBeenCalledWith('ratelimit:weather:user-1', 60);
    expect(handler).toHaveBeenCalledWith('user-1');
  });

  it('別のルートと別のユーザー ID でもそれぞれのキーで数えて userId を渡し、応答をそのまま返す（#435）', async () => {
    asUser('user-2');
    vi.mocked(cache.increment).mockResolvedValue(1);
    const customResponse = NextResponse.json({ ok: true, userId: 'user-2' }, { status: 201 });
    handler.mockResolvedValueOnce(customResponse);

    const response = await withUserRateLimit('scores', handler);

    expect(response).toBe(customResponse);
    expect(cache.increment).toHaveBeenCalledWith('ratelimit:scores:user-2', 60);
    expect(handler).toHaveBeenCalledWith('user-2');
  });

  it('Redis 障害時（increment が null）は制限せず、userId をハンドラへ渡す（#435）', async () => {
    asUser('user-2');
    vi.mocked(cache.increment).mockResolvedValue(null);

    const response = await withUserRateLimit('scores', handler);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith('user-2');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('isSignupRateLimited', () => {
  const from = (requestHeaders: Record<string, string>) =>
    vi.mocked(headers).mockResolvedValue(new Headers(requestHeaders) as never);
  const fromIp = (ip: string) => from({ 'cf-connecting-ip': ip });

  /** 通った回数を返す */
  const attempts = async (times: number, nextEmail: (i: number) => string) => {
    let passed = 0;
    for (let i = 0; i < times; i++) {
      if (!(await isSignupRateLimited(nextEmail(i)))) passed++;
    }
    return passed;
  };
  const distinctAddress = (i: number) => `user${i}@example.test`;

  beforeEach(() => {
    const counts = new Map<string, number>();
    vi.mocked(cache.increment).mockImplementation(async (key) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    });
  });

  it('接続元ごとに1時間10回まで', async () => {
    fromIp('203.0.113.1');

    await expect(attempts(12, distinctAddress)).resolves.toBe(10);
    expect(cache.increment).toHaveBeenCalledWith('ratelimit:signup:ip:203.0.113.1', 3600);
  });

  it('別の接続元は別に数える', async () => {
    fromIp('203.0.113.1');
    await attempts(11, distinctAddress);
    fromIp('203.0.113.2');

    await expect(isSignupRateLimited('other@example.test')).resolves.toBe(false);
  });

  it('同じアドレスは接続元が変わっても1時間3回まで', async () => {
    let passed = 0;
    for (let i = 0; i < 5; i++) {
      fromIp(`203.0.113.${i + 1}`);
      if (!(await isSignupRateLimited('owner@example.test'))) passed++;
    }

    expect(passed).toBe(3);
  });

  it('+ 以降と大文字小文字の違いは同じアドレスとして数える', async () => {
    fromIp('203.0.113.1');
    const aliases = [
      'owner@example.test',
      'owner+1@example.test',
      'OWNER+a+b@example.test',
      'Owner@EXAMPLE.test',
    ];

    await expect(attempts(aliases.length, (i) => aliases[i])).resolves.toBe(3);
  });

  it('ドメインが違えば別のアドレスとして数える', async () => {
    fromIp('203.0.113.1');

    await expect(attempts(4, (i) => `owner@example${i}.test`)).resolves.toBe(4);
  });

  it('IPv6 は同じ /64 をひとつの接続元として数える', async () => {
    const sameNetwork = [
      '2001:db8:1:2::1',
      '2001:0DB8:0001:0002:ffff:ffff:ffff:ffff',
      '2001:db8:1:2:3:4:5:6',
    ];
    let passed = 0;
    for (let i = 0; i < 12; i++) {
      fromIp(sameNetwork[i % sameNetwork.length]);
      if (!(await isSignupRateLimited(distinctAddress(i)))) passed++;
    }
    expect(passed).toBe(10);

    fromIp('2001:db8:1:3::1');
    await expect(isSignupRateLimited('other@example.test')).resolves.toBe(false);
  });

  it('/64 の途中で :: が終わるアドレスも同じに数える', async () => {
    fromIp('2001:db8::1');
    await attempts(11, distinctAddress);
    fromIp('2001:db8:0:0:1::');

    await expect(isSignupRateLimited('other@example.test')).resolves.toBe(true);
  });

  it('/64 の中に :: があるアドレスも、省略された0を埋めて数える', async () => {
    fromIp('2400:0:0:4:1:2:3:4');
    await attempts(11, distinctAddress);
    fromIp('2400::4:1:2:3:5');
    await expect(isSignupRateLimited('same-network@example.test')).resolves.toBe(true);

    fromIp('2400::5:1:2:3:4');
    await expect(isSignupRateLimited('other-network@example.test')).resolves.toBe(false);
  });

  it('CF-Connecting-IP が無ければ、ほかのヘッダを変えても同じ枠で数える', async () => {
    let passed = 0;
    for (let i = 0; i < 12; i++) {
      from({ 'x-forwarded-for': `198.51.100.${i + 1}`, 'x-real-ip': `198.51.100.${i + 1}` });
      if (!(await isSignupRateLimited(distinctAddress(i)))) passed++;
    }

    expect(passed).toBe(10);
  });

  it('IP として読めない値は Cloudflare を通らない要求と同じ枠で数える', async () => {
    from({});
    await attempts(11, distinctAddress);
    fromIp('not-an-ip');

    await expect(isSignupRateLimited('other@example.test')).resolves.toBe(true);
  });

  it('接続元の上限を超えた要求はアドレスの枠を減らさない', async () => {
    fromIp('203.0.113.1');
    await attempts(10, distinctAddress);
    await attempts(5, () => 'victim@example.test');
    fromIp('203.0.113.2');

    await expect(attempts(3, () => 'victim@example.test')).resolves.toBe(3);
  });

  it('アドレスは SHA-256 のハッシュにして1時間数える', async () => {
    fromIp('203.0.113.1');

    await isSignupRateLimited('Owner+1@example.test');

    const hash = createHash('sha256').update('owner@example.test').digest('hex');
    expect(cache.increment).toHaveBeenCalledWith(`ratelimit:signup:address:${hash}`, 3600);
  });

  it('Redis が使えないときは制限しない', async () => {
    fromIp('203.0.113.1');
    vi.mocked(cache.increment).mockResolvedValue(null);

    await expect(isSignupRateLimited('owner@example.test')).resolves.toBe(false);
  });
});
