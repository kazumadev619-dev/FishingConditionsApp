'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useFavoritesFetch } from '@/hooks/useFavoritesFetch';
import { useFavoritesOptimistic } from '@/hooks/useFavoritesOptimistic';
import type { FavoriteLocation } from '@/types/favorites';

interface FavoritesContextValue {
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

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/**
 * お気に入りの状態をダッシュボード全体で1つに揃える。
 *
 * 以前は useFavorites を呼ぶたびに独立した useState ができていたため、
 * ダッシュボードのハートとサイドバーのお気に入り一覧が別々の配列を見ていた。
 * 追加してもリロードするまで一覧に出てこなかったのはこれが原因（#77）。
 * ついでに、同じ一覧の GET が画面あたり3回走っていたのも1回になる。
 */
export function FavoritesProvider({ children }: { children: React.ReactNode }) {
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

  const value = useMemo(
    () => ({ favorites, isLoading, error, addFavorite, removeFavorite, isFavorite, refetch }),
    [favorites, isLoading, error, addFavorite, removeFavorite, isFavorite, refetch],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);

  if (!context) {
    // 握りつぶすと「一覧が更新されない」が静かに戻るので、気づける形で落とす
    throw new Error('useFavorites は FavoritesProvider の内側でのみ使える');
  }

  return context;
}
