/**
 * Upstash Redis キャッシュユーティリティ
 * @see https://docs.upstash.com/redis/sdks/ts/getstarted
 */

import { logger } from './logger';

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

interface CacheConfig {
  url: string;
  token: string;
}

/**
 * Upstash Redis REST APIを使用したキャッシュクライアント
 */
class CacheClient {
  private config: CacheConfig | null = null;

  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      this.config = { url, token };
    } else {
      logger.warn('Upstash Redis is not configured. Caching disabled.');
    }
  }

  /**
   * キャッシュが利用可能かどうか
   */
  public isAvailable(): boolean {
    return this.config !== null;
  }

  /**
   * Redis REST APIにコマンドを送信
   */
  private async executeCommand<T>(command: string[]): Promise<T | null> {
    if (!this.config) {
      return null;
    }

    try {
      const response = await fetch(`${this.config.url}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Redis command failed');
        return null;
      }

      const data = await response.json();
      return data.result as T;
    } catch (error) {
      logger.error({ error }, 'Redis command error');
      return null;
    }
  }

  /**
   * キャッシュからデータを取得
   * @param key キャッシュキー
   * @returns キャッシュされたデータ、またはnull
   */
  public async get<T>(key: string): Promise<T | null> {
    const result = await this.executeCommand<string>(['GET', key]);

    if (result === null) {
      return null;
    }

    try {
      return JSON.parse(result) as T;
    } catch (error) {
      logger.error({ key, error }, 'Failed to parse cached data');
      return null;
    }
  }

  /**
   * キャッシュにデータを保存
   * @param key キャッシュキー
   * @param value 保存するデータ
   * @param ttlSeconds TTL（秒）
   */
  public async set<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    const serialized = JSON.stringify(value);
    const result = await this.executeCommand<string>([
      'SET',
      key,
      serialized,
      'EX',
      String(ttlSeconds),
    ]);
    return result === 'OK';
  }

  /**
   * キャッシュからデータを削除
   * @param key キャッシュキー
   */
  public async delete(key: string): Promise<boolean> {
    const result = await this.executeCommand<number>(['DEL', key]);
    return result !== null && result > 0;
  }

  /**
   * パターンに一致するキーを削除（キャッシュ無効化）
   * @param pattern キーパターン（例: "weather:*"）
   */
  public async deleteByPattern(pattern: string): Promise<number> {
    // SCAN + DEL でパターン削除（Upstash REST APIでは直接KEYS使用可能）
    const keys = await this.executeCommand<string[]>(['KEYS', pattern]);

    if (!keys || keys.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (const key of keys) {
      const success = await this.delete(key);
      if (success) deleted++;
    }

    return deleted;
  }
}

// シングルトンインスタンス
export const cache = new CacheClient();

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
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  // キャッシュから取得を試みる
  const cached = await cache.get<T>(key);

  if (cached !== null) {
    logger.debug({ key }, 'Cache hit');
    return { data: cached, fromCache: true };
  }

  logger.debug({ key }, 'Cache miss');

  // fetcherでデータを取得
  const data = await fetcher();

  // キャッシュに保存（非同期、エラーは無視）
  cache.set(key, data, ttlSeconds).catch((error) => {
    logger.error({ key, error }, 'Failed to cache data');
  });

  return { data, fromCache: false };
}
