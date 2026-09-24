// src/hooks/useFavoritesOptimistic.ts
'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { logger } from '@/lib/logger';
import type {
  FavoriteAddResponse,
  FavoriteErrorResponse,
  FavoriteLocation,
} from '@/types/favorites';
import { buildFavoriteRequestBody } from './utils/favoriteRequestBuilder';

interface UseFavoritesOptimisticProps {
  favorites: FavoriteLocation[];
  setFavorites: Dispatch<SetStateAction<FavoriteLocation[]>>;
  fetchFavorites: () => Promise<void>;
}

// 楽観更新の一時行の id。一意でさえあればよいので連番で足りる
let tempSeq = 0;

export function useFavoritesOptimistic({
  favorites,
  setFavorites,
  fetchFavorites,
}: UseFavoritesOptimisticProps) {
  const addFavorite = useCallback(
    async (
      locationId?: string,
      portId?: string,
      lat?: number,
      lng?: number,
      name?: string,
    ): Promise<string> => {
      // 同時に複数追加したとき、失敗した1件だけを消せるよう毎回別の id にする。
      // FavoriteTab は id を React の key に使うので、固定値だと key も衝突する（#152）
      const tempId = `temp-${++tempSeq}`;
      const tempFavorite: FavoriteLocation = {
        id: tempId,
        locationId: locationId || tempId,
        name: name || '',
        latitude: lat || 0,
        longitude: lng || 0,
        createdAt: new Date().toISOString(),
      };

      setFavorites((prev) => [tempFavorite, ...prev]);

      try {
        const requestBody = buildFavoriteRequestBody(locationId, portId, lat, lng, name);

        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData: FavoriteErrorResponse = await response.json();

          if (response.status === 409) {
            // サーバ上では既に登録済み。ここでロールバックすると
            // 「登録済みなのにハートが灰色」という誤った表示に戻ってしまうので、
            // 一覧を取り直して UI を実態に合わせる（#78）
            await fetchFavorites();

            if (!errorData.locationId) {
              throw new Error('既にお気に入りに追加されています');
            }
            return errorData.locationId;
          }

          if (response.status === 404) {
            throw new Error('釣り場が見つかりません');
          }
          if (response.status === 401) {
            throw new Error('ログインが必要です');
          }

          throw new Error(errorData.error || 'お気に入りの追加に失敗しました');
        }

        const data: FavoriteAddResponse = await response.json();
        await fetchFavorites();
        return data.locationId;
      } catch (err) {
        logger.error({ err, locationId, portId, lat, lng }, 'Failed to add favorite');
        setFavorites((prev) => prev.filter((fav) => fav.id !== tempId));
        throw err;
      }
    },
    [setFavorites, fetchFavorites],
  );

  const removeFavorite = useCallback(
    async (locationId: string) => {
      const removed = favorites.find((fav) => fav.locationId === locationId);
      setFavorites((prev) => prev.filter((fav) => fav.locationId !== locationId));

      try {
        const response = await fetch(`/api/favorites?locationId=${locationId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const errorData = await response.json();

          if (response.status === 404) {
            throw new Error('お気に入りが見つかりません');
          } else if (response.status === 401) {
            throw new Error('ログインが必要です');
          }

          throw new Error(errorData.error || 'お気に入りの削除に失敗しました');
        }
      } catch (err) {
        logger.error({ err, locationId }, 'Failed to remove favorite');
        // クリック時点の配列を丸ごと戻すと、その間に成功した別の操作まで巻き戻る。
        // 消した1件だけを、サーバと同じ createdAt の新しい順の位置に戻す（#152）。
        // index やクリック時点の前後の行で決めると、操作や失敗の順番で並びが入れ替わる。
        // createdAt はどちらも toISOString() の文字列なので、文字列比較で新旧が決まる
        if (removed) {
          setFavorites((prev) => {
            if (prev.some((fav) => fav.locationId === locationId)) return prev;
            const at = prev.findIndex((fav) => fav.createdAt < removed.createdAt);
            return at === -1
              ? [...prev, removed]
              : [...prev.slice(0, at), removed, ...prev.slice(at)];
          });
        }
        throw err;
      }
    },
    [favorites, setFavorites],
  );

  return { addFavorite, removeFavorite };
}
