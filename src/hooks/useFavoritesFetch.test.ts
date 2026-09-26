import type { SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteLocation } from '@/types/favorites';
import { createFavoritesFetcher } from './useFavoritesFetch';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const fav = (locationId: string): FavoriteLocation => ({
  id: `fav-${locationId}`,
  locationId,
  name: locationId,
  latitude: 0,
  longitude: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** useState の代わり。isLoading の遷移を全部残す */
function createFetcher() {
  const state = {
    favorites: [] as FavoriteLocation[],
    error: null as string | null,
    loadingHistory: [] as boolean[],
  };
  const apply = <T>(prev: T, action: SetStateAction<T>) =>
    typeof action === 'function' ? (action as (p: T) => T)(prev) : action;
  const fetcher = createFavoritesFetcher({
    setFavorites: (a) => {
      state.favorites = apply(state.favorites, a);
    },
    setIsLoading: (a) => {
      state.loadingHistory.push(apply(state.loadingHistory.at(-1) ?? true, a));
    },
    setError: (a) => {
      state.error = apply(state.error, a);
    },
  });
  return { state, ...fetcher };
}

const ok = (favorites: FavoriteLocation[]) =>
  new Response(JSON.stringify({ favorites }), { status: 200 });

/** 解決を外から決められる fetch。呼ばれた順に resolve 関数を積む */
function deferredFetch() {
  const pending: Array<(res: Response) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
  );
  return pending;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createFavoritesFetcher（#217）', () => {
  it('取り直しが重なったら、後から返った古い一覧で上書きしない', async () => {
    const { state, fetchFavorites } = createFetcher();
    const pending = deferredFetch();

    const first = fetchFavorites();
    const second = fetchFavorites();
    pending[1](ok([fav('A'), fav('X')]));
    await second;
    pending[0](ok([fav('X')]));
    await first;

    expect(state.favorites.map((f) => f.locationId)).toEqual(['A', 'X']);
  });

  it('古い取り直しの失敗で、新しい一覧を消さない', async () => {
    const { state, fetchFavorites } = createFetcher();
    const pending = deferredFetch();

    const first = fetchFavorites();
    const second = fetchFavorites();
    pending[1](ok([fav('X')]));
    await second;
    pending[0](new Response('{}', { status: 500 }));
    await first;

    expect(state.favorites.map((f) => f.locationId)).toEqual(['X']);
    expect(state.error).toBeNull();
  });

  it('取り直しでは isLoading を立て直さない（一覧がスピナーに置き換わって点滅しない）', async () => {
    const { state, fetchFavorites } = createFetcher();
    const pending = deferredFetch();

    const initial = fetchFavorites();
    pending[0](ok([fav('X')]));
    await initial;
    const refetch = fetchFavorites();
    pending[1](ok([fav('X')]));
    await refetch;

    expect(state.loadingHistory).not.toContain(true);
    expect(state.loadingHistory.at(-1)).toBe(false);
  });

  it('取り直した一覧に処理中の操作を重ねる', async () => {
    const { state, fetchFavorites, pending: ops } = createFetcher();
    const pending = deferredFetch();
    const temp = (n: number, locationId: string) => ({ ...fav(locationId), id: `temp-${n}` });
    // 古い順に登録される。表示は楽観更新と同じく新しい順
    ops.adds.set('temp-1', temp(1, 'A'));
    ops.adds.set('temp-2', temp(2, 'B'));
    // POST は通ったが応答がまだ。サーバの一覧に既に載っているので二重にしない
    ops.adds.set('temp-3', temp(3, 'X'));
    ops.removes.add('Y');

    const p = fetchFavorites();
    pending[0](ok([fav('X'), fav('Y')]));
    await p;

    expect(state.favorites).toEqual([temp(2, 'B'), temp(1, 'A'), fav('X')]);
  });

  it('失敗のあとの成功でエラー表示を消す', async () => {
    const { state, fetchFavorites } = createFetcher();
    const pending = deferredFetch();

    const failed = fetchFavorites();
    pending[0](new Response('{}', { status: 401 }));
    await failed;
    expect(state.error).toBe('ログインが必要です');

    const retried = fetchFavorites();
    pending[1](ok([fav('X')]));
    await retried;
    expect(state.error).toBeNull();
    expect(state.favorites).toEqual([fav('X')]);
  });
});
