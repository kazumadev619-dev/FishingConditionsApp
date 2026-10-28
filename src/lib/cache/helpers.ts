import { logger } from '../logger';
import { cache } from './client';
import type { Cacheable, Jsonified } from './types';

export type { Cacheable, Jsonified } from './types';

type CacheReviver<T> = (cached: Jsonified<T>) => T;
type ReviverArgument<T> =
  Jsonified<T> extends T ? [revive?: CacheReviver<T>] : [revive: CacheReviver<T>];

/** キャッシュ経由の取得結果。 */
export interface CacheResponse<T> {
  data: T;
  fromCache: boolean;
  fetchedAt: string;
}

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
 * キャッシュから読み出した値を Date インスタンスへ復元する（revive 実装用の共通処理）。
 *
 * 素の `new Date(value)` を使わないこと。Date は JSON 往復で ISO 文字列に落ちるが、
 * **Invalid Date は `null` に落ちる**（`Date.prototype.toJSON` の仕様）。
 * `new Date(null)` は 1970-01-01 という「正常な Date」を返すため、壊れた値が
 * エラーも出さずスコア計算へ流れ込み、同じリクエストでもコールドとウォームで
 * 結果が変わるという追跡困難な状態になる。ここで明示的に落とす。
 *
 * @param value キャッシュから読み出した生の値
 * @param field エラーメッセージに出すフィールド名
 */
export function reviveDate(value: unknown, field: string): Date {
  if (value === null || value === undefined) {
    throw new Error(
      `Cached date field "${field}" is ${String(value)} (Invalid Date が往復した可能性)`,
    );
  }

  const revived = new Date(value as string | number | Date);

  if (Number.isNaN(revived.getTime())) {
    throw new Error(`Cached date field "${field}" is not a valid date: ${JSON.stringify(value)}`);
  }

  return revived;
}

/**
 * キャッシュを通してデータを取得するヘルパー関数
 * キャッシュミス時はfetcherを実行してキャッシュに保存
 *
 * キャッシュは JSON で往復するため、Date は読み出し時に ISO 文字列へ落ちる。
 * `Jsonified<T>` が `T` に代入できない型（Date を含むなど）では revive が必須になり、
 * revive は JSON 往復後の型を受け取る。指定漏れや `cached.sunrise.getTime()` のような
 * 書き間違いは型エラーになる（以前は「キャッシュヒットしたときだけ
 * `getHours is not a function`」という実行時エラーになっていた）。
 */
export async function withCache<T extends Cacheable>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  ...[revive]: ReviverArgument<T>
): Promise<{ data: T; fromCache: boolean }> {
  // キャッシュから取得を試みる
  const cached = await cache.get<T>(key);

  if (cached.hit) {
    // revive を省けるのは ReviverArgument が `Jsonified<T> extends T` を確かめた型だけなので、
    // このキャストは JSON 往復で型が変わらない場合に限られる
    return { data: revive ? revive(cached.value) : (cached.value as T), fromCache: true };
  }

  // fetcherでデータを取得
  const data = await fetcher();

  // キャッシュに保存（非同期、エラーは無視）
  cache.set(key, data, ttlSeconds).catch((error) => {
    logger.error({ key, error }, 'Failed to cache data');
  });

  return { data, fromCache: false };
}

/**
 * skipCache 時はキャッシュを一切使わず、通常時はキャッシュ経由で取得する。
 */
export async function fetchWithOptionalCache<T extends Cacheable>(
  cacheKey: string,
  ttl: number,
  skipCache: boolean,
  fetcher: () => Promise<T>,
  ...reviveArgs: ReviverArgument<T>
): Promise<CacheResponse<T>> {
  if (skipCache) {
    const data = await fetcher();
    return { data, fromCache: false, fetchedAt: new Date().toISOString() };
  }

  const { data, fromCache } = await withCache(cacheKey, ttl, fetcher, ...reviveArgs);
  return { data, fromCache, fetchedAt: new Date().toISOString() };
}
