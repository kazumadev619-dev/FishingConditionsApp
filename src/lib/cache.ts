/**
 * Redis キャッシュユーティリティ
 */
import { logger } from './logger';
import Redis from 'ioredis';

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

/**
 * ioredisを使用したキャッシュクライアント
 */
class CacheClient {
  private client: Redis | null = null;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
      });

      this.client.on('error', (err) => {
        logger.error({ err }, 'Redis client error');
        // 必要に応じて接続を閉じるなどの処理
        this.client?.quit();
        this.client = null;
      });
    } else {
      logger.warn('REDIS_URL is not configured. Caching disabled.');
    }
  }

  /**
   * キャッシュが利用可能かどうか
   */
  public isAvailable(): boolean {
    return this.client !== null && this.client.status === 'ready';
  }

  /**
   * キャッシュからデータを取得
   * @param key キャッシュキー
   * @returns キャッシュされたデータ、またはnull
   */
  public async get<T>(key: string): Promise<T | null> {
    if (!this.isAvailable() || !this.client) {
      return null;
    }

    try {
      const result = await this.client.get(key);
      if (result === null) {
        return null;
      }
      return JSON.parse(result) as T;
    } catch (error) {
      logger.error({ key, error }, 'Failed to get or parse cached data');
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
    if (!this.isAvailable() || !this.client) {
      return false;
    }
    try {
      const serialized = JSON.stringify(value);
      const result = await this.client.set(key, serialized, 'EX', ttlSeconds);
      return result === 'OK';
    } catch (error) {
      logger.error({ key, error }, 'Failed to set cache data');
      return false;
    }
  }

  /**
   * キャッシュからデータを削除
   * @param key キャッシュキー
   */
  public async delete(key: string): Promise<boolean> {
    if (!this.isAvailable() || !this.client) {
      return false;
    }
    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      logger.error({ key, error }, 'Failed to delete cache data');
      return false;
    }
  }

  /**
   * パターンに一致するキーを削除（キャッシュ無効化）
   * 本番環境でのKEYSコマンドの利用は避けるため、SCANを使用
   * @param pattern キーパターン（例: "weather:*"）
   */
  public async deleteByPattern(pattern: string): Promise<number> {
    if (!this.isAvailable() || !this.client) {
      return 0;
    }

    let deletedCount = 0;
    try {
      const stream = this.client.scanStream({
        match: pattern,
        count: 100,
      });

      for await (const keys of stream) {
        if (keys.length > 0) {
          deletedCount += await this.client.del(keys);
        }
      }
    } catch (error) {
      logger.error({ pattern, error }, 'Failed to delete cache data by pattern');
    }
    return deletedCount;
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
    return { data: cached, fromCache: true };
  }

  // fetcherでデータを取得
  const data = await fetcher();

  // キャッシュに保存（非同期、エラーは無視）
  cache.set(key, data, ttlSeconds).catch((error) => {
    logger.error({ key, error }, 'Failed to cache data');
  });

  return { data, fromCache: false };
}
