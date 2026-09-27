'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import type { FavoriteLocation, FavoritesResponse } from '@/types/favorites';

/** まだサーバの応答が返っていない楽観操作。useFavoritesOptimistic が出し入れする */
export interface PendingFavoriteOps {
  /** 一時行の id → 一時行。挿入順（古い順） */
  adds: Map<string, FavoriteLocation>;
  /** 楽観的に消した行の locationId */
  removes: Set<string>;
}

/**
 * 取り直した一覧に、処理中の楽観操作を重ね直す（#217）。
 * 丸ごと置き換えると、処理中の追加の一時行が消え、処理中の削除で消した行が戻って見える。
 */
export function overlayPending(
  server: FavoriteLocation[],
  pending: PendingFavoriteOps,
): FavoriteLocation[] {
  const onServer = new Set(server.map((fav) => fav.locationId));
  // 一時行は新しい順に先頭へ（楽観更新と同じ並び）。サーバに既に載った地点は二重にしない。
  // ponytail: portId / 座標での追加は一時行の locationId が仮なので、POST の確定後、
  // その追加自身の取り直しより先に別の取り直しが返ると一瞬二重に見える。自身の取り直しで消える
  const temps = Array.from(pending.adds.values())
    .reverse()
    .filter((fav) => !onServer.has(fav.locationId));
  return [...temps, ...server.filter((fav) => !pending.removes.has(fav.locationId))];
}

interface FetcherSetters {
  setFavorites: Dispatch<SetStateAction<FavoriteLocation[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

/** React の外に出してあるのはテストのため（jsdom を入れずに state の遷移を確かめる） */
export function createFavoritesFetcher({ setFavorites, setIsLoading, setError }: FetcherSetters) {
  const pending: PendingFavoriteOps = { adds: new Map(), removes: new Set() };
  let latest = 0;

  const fetchFavorites = async () => {
    // 取り直しが重なったら最後に始めたものだけを反映する。
    // 先に始めた方が後から返ると、古い一覧で上書きしてしまう（#217）
    const seq = ++latest;
    // isLoading は初回だけ。取り直しのたびに立てると、FavoriteTab が一覧ごと
    // スピナーに置き換わって点滅し、ダッシュボードのハートも押せなくなる（#217）

    try {
      const response = await fetch('/api/favorites');

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('ログインが必要です');
        }
        throw new Error('お気に入りの取得に失敗しました');
      }

      const data: FavoritesResponse = await response.json();
      if (seq !== latest) return;
      setFavorites(overlayPending(data.favorites, pending));
      setError(null);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch favorites');
      if (seq !== latest) return;
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setFavorites([]);
    } finally {
      if (seq === latest) setIsLoading(false);
    }
  };

  return { pending, fetchFavorites };
}

export function useFavoritesFetch() {
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [{ pending, fetchFavorites }] = useState(() =>
    createFavoritesFetcher({ setFavorites, setIsLoading, setError }),
  );

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  return { favorites, setFavorites, isLoading, error, fetchFavorites, pending };
}
