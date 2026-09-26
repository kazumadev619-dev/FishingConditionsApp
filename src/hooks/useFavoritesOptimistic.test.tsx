import type { SetStateAction } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteLocation } from '@/types/favorites';
import { useFavoritesOptimistic } from './useFavoritesOptimistic';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

/**
 * サーバは createdAt の新しい順で返す。テストでも同じ並びにするため、
 * 1文字目が若いほど新しくする（W > X > Y > Z の順に新しい）
 */
const fav = (locationId: string): FavoriteLocation => ({
  id: `fav-${locationId}`,
  locationId,
  name: locationId,
  latitude: 0,
  longitude: 0,
  createdAt: new Date(Date.UTC(2026, 0, 1) - locationId.charCodeAt(0) * 1000).toISOString(),
});

/** useState の代わり。関数形・値形のどちらの更新も手元の配列に当てる */
function createStore(initial: FavoriteLocation[]) {
  let state = initial;
  const setFavorites = (action: SetStateAction<FavoriteLocation[]>) => {
    state = typeof action === 'function' ? action(state) : action;
  };
  return { get: () => state, setFavorites };
}

/**
 * フックを現在の state で1回描画して関数を取り出す。
 * 実アプリでも操作ごとに再描画された最新のクロージャで呼ばれるので、操作の直前に毎回呼ぶ。
 */
function renderHook(store: ReturnType<typeof createStore>, fetchFavorites = async () => {}) {
  let result!: ReturnType<typeof useFavoritesOptimistic>;
  function Probe() {
    result = useFavoritesOptimistic({
      favorites: store.get(),
      setFavorites: store.setFavorites,
      fetchFavorites,
    });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return result;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

/** 解決を外から決められる fetch。呼ばれた順に resolve 関数を積む */
function deferredFetch() {
  const pending: Array<(res: Response) => void> = [];
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return pending;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFavoritesOptimistic', () => {
  it('削除の失敗は、その後に成功した別の削除を巻き戻さない', async () => {
    const store = createStore([fav('X'), fav('Y'), fav('Z')]);
    const pending = deferredFetch();

    const removeX = renderHook(store).removeFavorite('X');
    const removeY = renderHook(store).removeFavorite('Y');

    pending[1](jsonResponse(200, { success: true }));
    await removeY;
    pending[0](jsonResponse(500, { error: 'boom' }));
    await expect(removeX).rejects.toThrow('boom');

    // X だけが元の位置に戻り、成功した Y の削除は残る
    expect(store.get().map((f) => f.locationId)).toEqual(['X', 'Z']);
  });

  it('削除の失敗で戻す位置は、その間に上の行が消えていても元の並びを保つ', async () => {
    const store = createStore([fav('W'), fav('X'), fav('Y'), fav('Z')]);
    const pending = deferredFetch();

    const removeY = renderHook(store).removeFavorite('Y');
    const removeX = renderHook(store).removeFavorite('X');

    pending[1](jsonResponse(200, { success: true }));
    await removeX;
    pending[0](jsonResponse(500, { error: 'boom' }));
    await expect(removeY).rejects.toThrow('boom');

    expect(store.get().map((f) => f.locationId)).toEqual(['W', 'Y', 'Z']);
  });

  it('削除の失敗で戻すとき、元々後ろにあった行がすべて消えていれば末尾に戻す', async () => {
    const store = createStore([fav('W'), fav('X'), fav('Y')]);
    const pending = deferredFetch();

    const removeX = renderHook(store).removeFavorite('X');
    const removeY = renderHook(store).removeFavorite('Y');

    pending[1](jsonResponse(200, { success: true }));
    await removeY;
    pending[0](jsonResponse(500, { error: 'boom' }));
    await expect(removeX).rejects.toThrow('boom');

    expect(store.get().map((f) => f.locationId)).toEqual(['W', 'X']);
  });

  it('一覧に無い項目の削除が失敗しても、一覧を変えない', async () => {
    const store = createStore([fav('X')]);
    const pending = deferredFetch();

    const removeUnknown = renderHook(store).removeFavorite('unknown');
    pending[0](jsonResponse(500, { error: 'boom' }));
    await expect(removeUnknown).rejects.toThrow('boom');

    expect(store.get()).toEqual([fav('X')]);
  });

  // サーバ障害ではすべての削除が失敗し、先に送った方が先に失敗しやすい
  it.each([[['X', 'Y', 'Z']], [['X', 'Y']]])(
    '下の行→上の行の順に削除し、両方が送った順に失敗しても並びが戻る（%j）',
    async (ids) => {
      const store = createStore(ids.map(fav));
      const pending = deferredFetch();

      const removeY = renderHook(store).removeFavorite('Y');
      const removeX = renderHook(store).removeFavorite('X');

      pending[0](jsonResponse(500, { error: 'boom' }));
      await expect(removeY).rejects.toThrow('boom');
      pending[1](jsonResponse(500, { error: 'boom' }));
      await expect(removeX).rejects.toThrow('boom');

      expect(store.get().map((f) => f.locationId)).toEqual(ids);
    },
  );

  it('削除の失敗時、既に一覧に戻っている項目を二重に足さない', async () => {
    const store = createStore([fav('X'), fav('Y')]);
    const pending = deferredFetch();

    const removeX = renderHook(store).removeFavorite('X');
    // 別の操作の取り直しで、サーバ上にまだある X が一覧に戻ってきた
    store.setFavorites([fav('X'), fav('Y')]);
    pending[0](jsonResponse(500, { error: 'boom' }));
    await expect(removeX).rejects.toThrow('boom');

    expect(store.get().map((f) => f.locationId)).toEqual(['X', 'Y']);
  });

  it('同時に2件追加して一方が失敗しても、もう一方の楽観更新は消えず、id も衝突しない', async () => {
    const store = createStore([fav('X')]);
    const pending = deferredFetch();

    const addA = renderHook(store).addFavorite(undefined, 'port-a');
    const addB = renderHook(store).addFavorite(undefined, 'port-b');

    // id は React の key、locationId は FavoriteTab の削除中表示の判定に使われる
    const ids = store.get().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const locationIds = store.get().map((f) => f.locationId);
    expect(new Set(locationIds).size).toBe(locationIds.length);

    pending[0](jsonResponse(500, { error: 'boom' }));
    await expect(addA).rejects.toThrow('boom');

    // A の一時行だけが消え、B の一時行と既存の X は残る
    expect(store.get()).toHaveLength(2);
    expect(store.get()[1].locationId).toBe('X');

    pending[1](jsonResponse(200, { success: true, locationId: 'B' }));
    await expect(addB).resolves.toBe('B');
  });
});
