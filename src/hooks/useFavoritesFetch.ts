// src/hooks/useFavoritesFetch.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import type { FavoriteLocation, FavoritesResponse } from '@/types/favorites';

export function useFavoritesFetch() {
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  return { favorites, setFavorites, isLoading, error, fetchFavorites };
}
