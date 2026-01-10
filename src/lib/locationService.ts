/**
 * 場所検索サービス
 * Google Maps Geocoding API を使用して住所から座標を検索
 */

import { geocode } from './googleMapsClient';
import { withCache, generateCacheKey, CACHE_PREFIX, CACHE_TTL } from './cache';
import type { GeocodingResult } from '@/types/google.maps';
import type {
  LocationSearchResult,
  LocationSearchOptions,
  LocationSearchResponse,
} from '@/types/location';

/**
 * Google Maps Geocoding API のレスポンスを
 * アプリケーション用に整形
 */
function formatLocationResult(result: GeocodingResult): LocationSearchResult {
  // 住所コンポーネントをパース
  const addressComponents: Record<string, string> = {};
  result.address_components.forEach((component) => {
    if (component.types.includes('country')) {
      addressComponents.country = component.short_name;
    }
    if (component.types.includes('administrative_area_level_1')) {
      addressComponents.prefecture = component.long_name;
    }
    if (
      component.types.includes('locality') ||
      component.types.includes('administrative_area_level_2')
    ) {
      addressComponents.city = component.long_name;
    }
    if (component.types.includes('route') || component.types.includes('street_address')) {
      addressComponents.street = component.long_name;
    }
  });

  return {
    place_id: result.place_id,
    name: result.name,
    formatted_address: result.formatted_address,
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
    address_components: addressComponents,
    location_type: result.geometry.location_type,
  };
}

/**
 * 検索クエリから日本フィルタを含むクエリに変換
 * @param query 元のクエリ
 * @returns 日本限定のクエリ
 */
function buildJapanScopedQuery(query: string): string {
  // 既に日本を含む場合はそのまま使用
  if (query.toLowerCase().includes('japan') || query.includes('日本')) {
    return query;
  }
  // 日本を明示的に付加
  return `${query}, Japan`;
}

/**
 * 場所を検索
 * @param query 検索クエリ（地名、住所など）
 * @param options 検索オプション
 * @returns 検索結果
 */
export async function searchLocations(
  query: string,
  options: LocationSearchOptions = {},
): Promise<LocationSearchResponse<LocationSearchResult>> {
  const { skipCache = false, limit = 10 } = options;

  // クエリのバリデーション
  if (!query || query.trim().length < 2) {
    throw new Error('Search query must be at least 2 characters');
  }

  if (query.length > 200) {
    throw new Error('Search query must be less than 200 characters');
  }

  // 日本フィルタを適用
  const scopedQuery = buildJapanScopedQuery(query.trim());

  // キャッシュキーを生成
  const cacheKey = generateCacheKey(CACHE_PREFIX.LOCATION, {
    query: scopedQuery,
    limit,
  });

  // 検索処理
  const fetchLocations = async (): Promise<LocationSearchResult[]> => {
    const response = await geocode(scopedQuery);

    if (!response.results || response.results.length === 0) {
      return [];
    }

    // 結果を整形して上限まで返す
    return response.results.slice(0, limit).map(formatLocationResult);
  };

  // キャッシュを使用して検索実行
  if (skipCache) {
    const data = await fetchLocations();
    return {
      data,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
      query,
    };
  }

  const { data, fromCache } = await withCache(cacheKey, CACHE_TTL.LOCATION, fetchLocations);

  return {
    data,
    fromCache,
    fetchedAt: new Date().toISOString(),
    query,
  };
}

/**
 * Google Maps API が設定されているか確認
 */
export function isLocationSearchConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
}
