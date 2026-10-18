// src/lib/cache.ts（re-export のみ）

export { cache } from './cache/client';
export { CACHE_PREFIX, CACHE_TTL } from './cache/config';
export {
  type CacheResponse,
  fetchWithOptionalCache,
  generateCacheKey,
  type Jsonified,
  reviveDate,
  withCache,
} from './cache/helpers';
