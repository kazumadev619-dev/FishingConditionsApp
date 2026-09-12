'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useFavorites } from '@/components/providers/favorites-provider';
import { logger } from '@/lib/logger';

interface LocationSource {
  type: 'port' | 'coordinates';
  portId?: string;
  coordinates?: { lat: number; lng: number; name: string };
}

interface DashboardLocation {
  id?: string;
  source?: LocationSource;
}

export function useDashboardFavorite(location: DashboardLocation) {
  const router = useRouter();
  const { isFavorite: checkIsFavorite, addFavorite, removeFavorite, isLoading } = useFavorites();

  const locationId = location.id || '';
  const isFavorite = checkIsFavorite(locationId);

  const handleToggleFavorite = useCallback(async () => {
    try {
      const currentIsFavorite = checkIsFavorite(locationId);
      if (currentIsFavorite) {
        await removeFavorite(locationId);
        return;
      }

      let newLocationId: string;

      if (location.id) {
        newLocationId = await addFavorite(location.id);
      } else if (location.source?.type === 'port' && location.source.portId) {
        newLocationId = await addFavorite(undefined, location.source.portId);
      } else if (location.source?.type === 'coordinates' && location.source.coordinates) {
        newLocationId = await addFavorite(
          undefined,
          undefined,
          location.source.coordinates.lat,
          location.source.coordinates.lng,
          location.source.coordinates.name,
        );
      } else {
        return;
      }

      router.replace(`/dashboard?locationId=${newLocationId}`);
    } catch (err) {
      // useFavorites 側でも記録しているが、どの地点の操作が失敗したかはここにしかない
      logger.error({ err, locationId, source: location.source?.type }, 'Failed to toggle favorite');
    }
  }, [locationId, location, addFavorite, removeFavorite, router, checkIsFavorite]);

  return { isFavorite, isLoading, handleToggleFavorite };
}
