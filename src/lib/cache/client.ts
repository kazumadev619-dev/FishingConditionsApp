import Redis from 'ioredis';
import { logger } from '../logger';

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
        // 指数的に間隔を空けて再接続する（上限 5 秒）
        retryStrategy: (times) => Math.min(times * 200, 5000),
      });

      // エラー時に client を破棄しないこと。ioredis は自動再接続するため、
      // ここで quit()/null 代入をすると Pod 再起動までキャッシュが復活しない。
      // 接続断中は isAvailable() が false を返し、呼び出し側は素通しになる。
      this.client.on('error', (err) => {
        logger.error({ err }, 'Redis client error');
      });

      this.client.on('reconnecting', (delay: number) => {
        logger.warn({ delay }, 'Redis client reconnecting');
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
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
