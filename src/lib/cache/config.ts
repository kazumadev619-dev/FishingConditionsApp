// キャッシュのTTL定数（秒単位）
export const CACHE_TTL = {
  WEATHER: 30 * 60, // 30分
  TIDE: 6 * 60 * 60, // 6時間
  LOCATION: 60 * 60, // 1時間
} as const;

// キャッシュキーのプレフィックス
export const CACHE_PREFIX = {
  WEATHER: 'weather',
  TIDE: 'tide',
  LOCATION: 'location',
} as const;
