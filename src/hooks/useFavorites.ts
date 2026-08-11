// src/hooks/useFavorites.ts
'use client';

import { useCallback } from 'react';
import type { FavoriteLocation } from '@/types/favorites';
import { useFavoritesFetch } from './useFavoritesFetch';
import { useFavoritesOptimistic } from './useFavoritesOptimistic';

interface UseFavoritesReturn {
  favorites: FavoriteLocation[];
  isLoading: boolean;
  error: string | null;
  /** お気に入り追加。成功時は登録されたlocationIdを返す */
  addFavorite: (
    locationId?: string,
    portId?: string,
    lat?: number,
    lng?: number,
    name?: string,
  ) => Promise<string>;
  removeFavorite: (locationId: string) => Promise<void>;
  isFavorite: (locationId: string) => boolean;
  refetch: () => void;
}

export function useFavorites(): UseFavoritesReturn {
  const { favorites, setFavorites, isLoading, error, fetchFavorites } = useFavoritesFetch();
  const { addFavorite, removeFavorite } = useFavoritesOptimistic({
    favorites,
    setFavorites,
    fetchFavorites,
  });

  const isFavorite = useCallback(
    (locationId: string) => favorites.some((fav) => fav.locationId === locationId),
    [favorites],
  );

  const refetch = useCallback(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  return { favorites, isLoading, error, addFavorite, removeFavorite, isFavorite, refetch };
}
