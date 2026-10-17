import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('./client', () => ({ cache: cacheMock }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));

import { fetchWithOptionalCache } from './helpers';

beforeEach(() => {
  vi.clearAllMocks();
  // 途中で落ちたテストの偽の時計を次のテストに持ち越さない
  vi.useRealTimers();
  cacheMock.set.mockResolvedValue(true);
});

describe('fetchWithOptionalCache', () => {
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
    cacheMock.get.mockResolvedValue(cached);
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
    cacheMock.get.mockResolvedValue(null);
    const data = { value: 'fresh' };
    const fetcher = vi.fn().mockResolvedValue(data);

    await expect(fetchWithOptionalCache('test:key', 60, false, fetcher)).resolves.toMatchObject({
      data,
      fromCache: false,
    });

    expect(cacheMock.set).toHaveBeenCalledWith('test:key', data, 60);
  });

  it('fetcher の例外をそのまま伝播する', async () => {
    cacheMock.get.mockResolvedValue(null);
    const error = new Error('upstream failed');
    const fetcher = vi.fn().mockRejectedValue(error);

    await expect(fetchWithOptionalCache('test:key', 60, false, fetcher)).rejects.toThrow(error);
    await expect(fetchWithOptionalCache('test:key', 60, true, fetcher)).rejects.toThrow(error);
    expect(cacheMock.set).not.toHaveBeenCalled();
  });
});
