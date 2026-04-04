'use client';

import { Loader2, MapPin, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { logger } from '@/lib/logger';
import type { FavoriteLocation } from '@/types/favorites';

interface FavoriteTabProps {
  favorites: FavoriteLocation[];
  isLoading: boolean;
  error: string | null;
  onRemove: (locationId: string) => Promise<void>;
  onRefresh: () => void;
}

export function FavoriteTab({
  favorites,
  isLoading,
  error,
  onRemove,
  onRefresh,
}: FavoriteTabProps) {
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleLocationClick = useCallback(
    (location: FavoriteLocation) => {
      // locationId で dashboard に遷移
      router.push(`/dashboard?locationId=${location.locationId}`);
    },
    [router],
  );

  const handleRemove = useCallback(
    async (e: React.MouseEvent, locationId: string) => {
      e.stopPropagation();

      try {
        setRemovingId(locationId);
        await onRemove(locationId);
        onRefresh();
      } catch (err) {
        logger.error({ err, locationId }, 'Failed to remove favorite');
      } finally {
        setRemovingId(null);
      }
    },
    [onRemove, onRefresh],
  );

  // ローディング状態
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // エラー状態
  if (error) {
    return <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>;
  }

  // 空状態
  if (favorites.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        お気に入りはまだありません
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {favorites.map((location) => (
          <button
            key={location.id}
            type="button"
            onClick={() => handleLocationClick(location)}
            className="w-full flex items-start justify-between gap-2 rounded-lg border p-3 text-left hover:bg-muted transition-colors"
          >
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{location.name}</div>
                {(location.prefecture || location.region) && (
                  <div className="text-xs text-muted-foreground truncate">
                    {[location.prefecture, location.region].filter(Boolean).join(' ')}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => handleRemove(e, location.locationId)}
              disabled={removingId === location.locationId}
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
              aria-label="お気に入りから削除"
            >
              {removingId === location.locationId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
