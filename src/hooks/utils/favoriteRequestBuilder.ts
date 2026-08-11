// src/hooks/utils/favoriteRequestBuilder.ts
import type { FavoriteRequest } from '@/types/favorites';

export function buildFavoriteRequestBody(
  locationId?: string,
  portId?: string,
  lat?: number,
  lng?: number,
  name?: string,
): FavoriteRequest {
  if (locationId) {
    return { locationId };
  }
  if (portId) {
    return { portId };
  }
  if (lat !== undefined && lng !== undefined && name) {
    return { coordinates: { lat, lng, name } };
  }
  return {};
}
