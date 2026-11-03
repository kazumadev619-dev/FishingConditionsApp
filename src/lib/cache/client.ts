import Redis from 'ioredis';
import { logger } from '../logger';
import type { Jsonified } from './types';

export type CacheReadResult<T> = { hit: true; value: T } | { hit: false };

/**
 * Redis の error を記録する最短の間隔。再接続は 5 秒ごとに無期限で続くので、
 * 間引かないと切断中の1本の接続だけで error が1日に約 17,000 行になる（#121）。
 */
const ERROR_LOG_INTERVAL_MS = 5 * 60 * 1000;

const COMMAND_TIMEOUT_MS = 1000;

/**
 * ioredisを使用したキャッシュクライアント
 */
class CacheClient {
  private client: Redis | null = null;
  private failedAttempts = 0;
  private lastErrorLoggedAt = 0;
  private lastCommandErrorLoggedAt = 0;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        // 接続は保ったまま Redis が黙ると、コマンドが返らず呼び出し元のリクエストも止まる（#336）。
        // 普段の応答は 1ms 未満（ローカルの実測で最大 1ms）。cache の全コマンドに効くので、
        // 余裕を持たせつつ、リクエストを長く止めない 1 秒にする。超えたら既存の catch がミスや null に落とす。
        commandTimeout: COMMAND_TIMEOUT_MS,
        // 試行回数に比例して間隔を空けて再接続する（200ms 刻み、上限 5 秒）。
        // null を返さない＝諦めない。Redis が長時間落ちていても、復旧すれば戻る。
        retryStrategy: (times) => Math.min(times * 200, 5000),
      });

      // エラー時に client を破棄しないこと。ioredis は自動再接続するため、
      // ここで quit()/null 代入をすると Pod 再起動までキャッシュが復活しない。
      // 接続断中は isAvailable() が false を返し、呼び出し側は素通しになる。
      this.client.on('error', (err) => {
        this.failedAttempts++;
        const now = Date.now();
        if (now - this.lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) {
          return;
        }
        this.lastErrorLoggedAt = now;
        logger.error({ err, failedAttempts: this.failedAttempts }, 'Redis client error');
      });

      this.client.on('reconnecting', (delay: number) => {
        logger.debug({ delay }, 'Redis client reconnecting');
      });

      this.client.on('ready', () => {
        logger.info({ failedAttempts: this.failedAttempts }, 'Redis client ready');
        this.failedAttempts = 0;
      });
    } else {
      logger.warn('REDIS_URL is not configured. Caching disabled.');
    }
  }

  /**
   * コマンド失敗のログ。Redis が黙っている間はリクエストごとに失敗するので、
   * 接続エラーと同じ間隔で間引く（#343）。最初の1回は key とエラーごと ERROR で残し、
   * 間引いた分は debug に落とす。接続エラーの間引きとは別に数える
   * （接続エラーを出した直後でも、コマンド失敗の最初の1回は残すため）。
   */
  private logCommandError(fields: Record<string, unknown>, message: string): void {
    const now = Date.now();
    if (now - this.lastCommandErrorLoggedAt < ERROR_LOG_INTERVAL_MS) {
      logger.debug(fields, message);
      return;
    }
    this.lastCommandErrorLoggedAt = now;
    logger.error(fields, message);
  }

  /**
   * 接続を閉じ、再接続もやめる。元に戻せず、このインスタンスは以後ずっと素通しになる
   */
  public disconnect(): void {
    this.client?.disconnect();
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
   * @returns キャッシュヒットの有無と、ヒット時の値
   */
  public async get<T>(key: string): Promise<CacheReadResult<Jsonified<T>>> {
    if (!this.isAvailable() || !this.client) {
      return { hit: false };
    }

    let result: string | null;
    try {
      result = await this.client.get(key);
    } catch (error) {
      this.logCommandError({ key, error }, 'Failed to get cached data');
      return { hit: false };
    }

    if (result === null) {
      return { hit: false };
    }

    try {
      return { hit: true, value: JSON.parse(result) as Jsonified<T> };
    } catch (error) {
      logger.error({ key, error }, 'Failed to parse cached data');
      return { hit: false };
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
      // undefined や関数は JSON にならない。そのまま渡すと Redis に空文字列が入り、
      // 読み出すたびに parse に失敗してミス扱いになるので、書かずに知らせる
      if (serialized === undefined) {
        logger.warn({ key }, 'Skipped caching a value that JSON cannot represent');
        return false;
      }
      const result = await this.client.set(key, serialized, 'EX', ttlSeconds);
      return result === 'OK';
    } catch (error) {
      this.logCommandError({ key, error }, 'Failed to set cache data');
      return false;
    }
  }

  /**
   * カウンタを1増やして、増やした後の値を返す。使えないときは null
   * @param key カウンタのキー
   * @param ttlSeconds 最初に増やした時点から数える TTL（秒）
   */
  public async increment(key: string, ttlSeconds: number): Promise<number | null> {
    if (!this.isAvailable() || !this.client) {
      return null;
    }
    try {
      // INCR の後に EXPIRE を分けて送ると、間で切れたとき TTL の無いキーが残り続ける
      const results = await this.client
        .multi()
        .set(key, 0, 'EX', ttlSeconds, 'NX')
        .incr(key)
        .exec();
      const [error, count] = results?.[1] ?? [new Error('Empty transaction result')];
      if (error) {
        throw error;
      }
      return count as number;
    } catch (err) {
      this.logCommandError({ key, err }, 'Failed to increment counter');
      return null;
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
      this.logCommandError({ key, error }, 'Failed to delete cache data');
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
      this.logCommandError({ pattern, error }, 'Failed to delete cache data by pattern');
    }
    return deletedCount;
  }
}

// next dev はこのモジュールを評価し直すので、使い回さないと接続が増え続ける。
// NODE_ENV で分岐しないこと。RSC とルートハンドラは本番でも別々に評価するので、
// 分岐すると本番の接続とログが2倍になる（#121）。
// 使い回す代わりに、このファイルの変更を next dev で反映するには再起動が要る。
const globalForCache = globalThis as typeof globalThis & { cacheClient?: CacheClient };
globalForCache.cacheClient ??= new CacheClient();
export const cache = globalForCache.cacheClient;
