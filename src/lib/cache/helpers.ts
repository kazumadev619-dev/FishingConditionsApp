import { logger } from '../logger';
import { cache } from './client';

/**
 * キャッシュキーを生成するヘルパー関数
 */
export function generateCacheKey(prefix: string, params: Record<string, string | number>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}:${params[key]}`)
    .join(':');
  return `${prefix}:${sortedParams}`;
}

/**
 * キャッシュを通してデータを取得するヘルパー関数
 * キャッシュミス時はfetcherを実行してキャッシュに保存
 *
 * @param revive キャッシュヒット時に値を復元する関数。
 *   キャッシュは JSON で往復するため、Date のような構造を持つ値は読み出し時に
 *   素の文字列へ落ちる。`cache.get<T>()` は `JSON.parse(...) as T` で型を主張し直すので
 *   TypeScript はこのズレを検出できない。**T が Date を含むなら必ず指定すること。**
 *   指定を忘れると「キャッシュヒットしたときだけ `getHours is not a function`」という、
 *   ローカルでは再現しにくい実行時エラーになる。
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  revive?: (cached: T) => T,
): Promise<{ data: T; fromCache: boolean }> {
  // キャッシュから取得を試みる
  const cached = await cache.get<T>(key);

  if (cached !== null) {
    return { data: revive ? revive(cached) : cached, fromCache: true };
  }

  // fetcherでデータを取得
  const data = await fetcher();

  // キャッシュに保存（非同期、エラーは無視）
  cache.set(key, data, ttlSeconds).catch((error) => {
    logger.error({ key, error }, 'Failed to cache data');
  });

  return { data, fromCache: false };
}
