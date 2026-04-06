// src/hooks/useFavoritesOptimistic.ts
'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { logger } from '@/lib/logger';
import type { FavoriteAddResponse, FavoriteLocation } from '@/types/favorites';
import { buildFavoriteRequestBody } from './utils/favoriteRequestBuilder';

interface UseFavoritesOptimisticProps {
  favorites: FavoriteLocation[];
  setFavorites: Dispatch<SetStateAction<FavoriteLocation[]>>;
  fetchFavorites: () => Promise<void>;
}

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
        const requestBody = buildFavoriteRequestBody(locationId, portId, lat, lng, name);

        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

        const data: FavoriteAddResponse = await response.json();
        await fetchFavorites();
        return data.locationId;
      } catch (err) {
        logger.error({ err, locationId, portId, lat, lng }, 'Failed to add favorite');
        setFavorites((prev) => prev.filter((fav) => fav.id !== 'temp'));
        throw err;
      }
    },
    [setFavorites, fetchFavorites],
  );

  const removeFavorite = useCallback(
    async (locationId: string) => {
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
        setFavorites(previousFavorites);
        throw err;
      }
    },
    [favorites, setFavorites],
  );

  return { addFavorite, removeFavorite };
}
