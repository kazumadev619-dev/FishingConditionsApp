import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('./client', () => ({ cache: cacheMock }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));

import { fetchWithOptionalCache, withCache } from './helpers';

beforeEach(() => {
  vi.clearAllMocks();
  // 途中で落ちたテストの偽の時計を次のテストに持ち越さない
  vi.useRealTimers();
  cacheMock.set.mockResolvedValue(true);
});

// 型テスト: tsc（npm run type-check）が検査する。vitest は実行時の中身しか見ない
describe('revive の型による強制', () => {
  type Payload = { observedAt: Date };
  const fetchPayload = async (): Promise<Payload> => ({ observedAt: new Date() });

  it('Date を含む値は revive なしでキャッシュできない', () => {
    const calls = [
      // @ts-expect-error Date が JSON で文字列になるため revive が必須
      () => withCache('test:key', 60, fetchPayload),
      // @ts-expect-error Date が JSON で文字列になるため revive が必須
      () => fetchWithOptionalCache('test:key', 60, false, fetchPayload),
    ];

    expectTypeOf(calls).toBeArray();
  });

  it('revive は JSON 往復後の型を受け取り、Date として扱うと型エラーになる', () => {
    const call = () =>
      withCache('test:key', 60, fetchPayload, (cached) => {
        expectTypeOf(cached.observedAt).toEqualTypeOf<string>();
        // @ts-expect-error 実体は文字列なので Date のメソッドは無い
        cached.observedAt.getTime();
        return { observedAt: new Date(cached.observedAt) };
      });

    expectTypeOf(call).toBeFunction();
  });

  it('undefined を返す fetcher はキャッシュできない（JSON にならず毎回ミスする）', () => {
    const fetchUndefined = async () => undefined;
    const calls = [
      // @ts-expect-error undefined は Cacheable ではない
      () => withCache('test:key', 60, fetchUndefined),
      // @ts-expect-error undefined は Cacheable ではない
      () => fetchWithOptionalCache('test:key', 60, false, fetchUndefined),
    ];

    expectTypeOf(calls).toBeArray();
  });

  it('JSON 往復で型が変わらない値は revive を省ける', () => {
    const call = () =>
      fetchWithOptionalCache('test:key', 60, false, async () => ({ name: 'a', tags: ['b'] }));

    expectTypeOf(call).toBeFunction();
  });
});

describe('fetchWithOptionalCache', () => {
  it('値が null のキャッシュヒットでは fetcher を呼ばない', async () => {
    cacheMock.get.mockResolvedValue({ hit: true, value: null });
    const fetcher = vi.fn().mockResolvedValue('fresh');

    await expect(
      fetchWithOptionalCache<null | string>('test:key', 60, false, fetcher),
    ).resolves.toMatchObject({
      data: null,
      fromCache: true,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
  });

  it('skipCache ではキャッシュを読まず書かずに fetcher のデータを返す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'));
    const fetcher = vi.fn().mockResolvedValue({ value: 'fresh' });

    await expect(fetchWithOptionalCache('test:key', 60, true, fetcher)).resolves.toEqual({
      data: { value: 'fresh' },
      fromCache: false,
      fetchedAt: '2026-10-12T00:00:00.000Z',
    });

    expect(cacheMock.get).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('キャッシュヒット時は復元した値を返し fetcher を呼ばない', async () => {
    const cached = { observedAt: '2026-10-11T00:00:00.000Z' };
    const revived = { observedAt: new Date(cached.observedAt) };
    cacheMock.get.mockResolvedValue({ hit: true, value: cached });
    const fetcher = vi.fn().mockResolvedValue({ observedAt: new Date() });
    const revive = vi.fn().mockReturnValue(revived);

    await expect(
      fetchWithOptionalCache('test:key', 60, false, fetcher, revive),
    ).resolves.toMatchObject({
      data: revived,
      fromCache: true,
    });

    expect(revive).toHaveBeenCalledWith(cached);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
  });

  it('キャッシュミス時は fetcher の結果をTTL付きでキャッシュする', async () => {
    cacheMock.get.mockResolvedValue({ hit: false });
    const data = { value: 'fresh' };
    const fetcher = vi.fn().mockResolvedValue(data);

    await expect(fetchWithOptionalCache('test:key', 60, false, fetcher)).resolves.toMatchObject({
      data,
      fromCache: false,
    });

    expect(cacheMock.set).toHaveBeenCalledWith('test:key', data, 60);
  });

  it('fetcher の例外をそのまま伝播する', async () => {
    cacheMock.get.mockResolvedValue({ hit: false });
    const error = new Error('upstream failed');
    const fetcher = vi.fn().mockRejectedValue(error);

    await expect(fetchWithOptionalCache('test:key', 60, false, fetcher)).rejects.toThrow(error);
    await expect(fetchWithOptionalCache('test:key', 60, true, fetcher)).rejects.toThrow(error);
    expect(cacheMock.set).not.toHaveBeenCalled();
  });
});
