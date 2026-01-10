'use client';

import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/logger';
import type { FavoriteLocation, FavoritesResponse } from '@/types/favorites';

interface UseFavoritesReturn {
  favorites: FavoriteLocation[];
  isLoading: boolean;
  error: string | null;
  addFavorite: (
    locationId?: string,
    portId?: string,
    lat?: number,
    lng?: number,
    name?: string,
  ) => Promise<void>;
  removeFavorite: (locationId: string) => Promise<void>;
  isFavorite: (locationId: string) => boolean;
  refetch: () => void;
}

export function useFavorites(): UseFavoritesReturn {
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // お気に入り一覧を取得
  const fetchFavorites = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/favorites');

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('ログインが必要です');
        }
        throw new Error('お気に入りの取得に失敗しました');
      }

      const data: FavoritesResponse = await response.json();
      setFavorites(data.favorites);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch favorites');
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setFavorites([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回マウント時に取得
  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  // お気に入りに追加
  const addFavorite = useCallback(
    async (locationId?: string, portId?: string, lat?: number, lng?: number, name?: string) => {
      // 楽観的UI更新（仮のお気に入りを追加）
      const tempFavorite: FavoriteLocation = {
        id: 'temp',
        locationId: locationId || 'temp',
        name: name || '',
        latitude: lat || 0,
        longitude: lng || 0,
        createdAt: new Date().toISOString(),
      };

      setFavorites((prev) => [tempFavorite, ...prev]);

      try {
        // リクエストボディを構築
        const requestBody: {
          locationId?: string;
          portId?: string;
          coordinates?: { lat: number; lng: number; name: string };
        } = {};

        if (locationId) {
          requestBody.locationId = locationId;
        } else if (portId) {
          requestBody.portId = portId;
        } else if (lat !== undefined && lng !== undefined && name) {
          requestBody.coordinates = { lat, lng, name };
        }

        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();

          if (response.status === 409) {
            throw new Error('既にお気に入りに追加されています');
          } else if (response.status === 404) {
            throw new Error('釣り場が見つかりません');
          } else if (response.status === 401) {
            throw new Error('ログインが必要です');
          }

          throw new Error(errorData.error || 'お気に入りの追加に失敗しました');
        }

        // 成功したら最新のデータを取得
        await fetchFavorites();
      } catch (err) {
        logger.error({ err, locationId, portId, lat, lng }, 'Failed to add favorite');

        // エラーが発生したら楽観的更新を元に戻す
        setFavorites((prev) => prev.filter((fav) => fav.id !== 'temp'));

        throw err;
      }
    },
    [fetchFavorites],
  );

  // お気に入りから削除
  const removeFavorite = useCallback(
    async (locationId: string) => {
      // 楽観的UI更新（削除対象を除外）
      const previousFavorites = favorites;
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

        // エラーが発生したら楽観的更新を元に戻す
        setFavorites(previousFavorites);

        throw err;
      }
    },
    [favorites],
  );

  // 指定されたlocationIdがお気に入りに含まれているか
  const isFavorite = useCallback(
    (locationId: string) => {
      return favorites.some((fav) => fav.locationId === locationId);
    },
    [favorites],
  );

  // 手動でリフレッシュ
  const refetch = useCallback(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  return {
    favorites,
    isLoading,
    error,
    addFavorite,
    removeFavorite,
    isFavorite,
    refetch,
  };
}
