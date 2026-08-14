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
 * キャッシュから読み出した値を Date インスタンスへ復元する（revive 実装用の共通処理）。
 *
 * 素の `new Date(value)` を使わないこと。Date は JSON 往復で ISO 文字列に落ちるが、
 * **Invalid Date は `null` に落ちる**（`Date.prototype.toJSON` の仕様）。
 * `new Date(null)` は 1970-01-01 という「正常な Date」を返すため、壊れた値が
 * エラーも出さずスコア計算へ流れ込み、同じリクエストでもコールドとウォームで
 * 結果が変わるという追跡困難な状態になる。ここで明示的に落とす。
 *
 * @param value キャッシュから読み出した生の値（型上は Date だが実体は文字列）
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
