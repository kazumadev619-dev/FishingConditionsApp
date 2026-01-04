// API エラーの種類を定義
import { withCache, generateCacheKey } from './cache';
import { logger } from './logger';

export enum ApiErrorType {
  TIMEOUT = 'TIMEOUT', // リクエストタイムアウト
  RATE_LIMITED = 'RATE_LIMITED', // API レート制限（429）
  SERVER_ERROR = 'SERVER_ERROR', // サーバーエラー（5xx）
  CLIENT_ERROR = 'CLIENT_ERROR', // クライアントエラー（4xx）
  NETWORK_ERROR = 'NETWORK_ERROR', // ネットワークエラー
}

// Apiエラークラス
export class ApiError extends Error {
  constructor(
    message: string,
    public type: ApiErrorType,
    public statusCode?: number,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'cache'> {
  params?: Record<string, string>;
  timeout?: number; // ミリ秒単位のタイムアウト（デフォルト: 10000）
  retries?: number; // リトライ回数（デフォルト: 3）
  cache?: {
    ttl: number; // TTL（秒）
    key?: string; // キャッシュキー（省略時は自動生成）
    prefix?: string; // キャッシュキーのプレフィックス
  };
}

// リトライ可能なHTTPステータスコード
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

// リトライ不可のHTTPステータスコード（クライアントエラー）
const NON_RETRYABLE_STATUS_CODES = [400, 401, 403, 404];

class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  // APIキーをクエリパラメータとして渡すか、ヘッダーで渡すかを指定
  private keyLocation: 'query' | 'header';
  private keyName: string;
  // APIクライアントが正しく設定されているかを示すフラグ
  private isConfigured: boolean = true;

  // デフォルト設定
  private readonly DEFAULT_TIMEOUT_MS = 10000; // 10秒
  private readonly DEFAULT_RETRIES = 3;

  constructor(
    baseUrl: string,
    apiKey: string,
    keyLocation: 'query' | 'header' = 'header', // デフォルトはヘッダー
    keyName: string = 'X-API-Key', // デフォルトのヘッダー/クエリ名
    requireApiKey: boolean = true, // APIキーが必須かどうか
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.keyLocation = keyLocation;
    this.keyName = keyName;

    // APIキーが必要なのに未設定の場合、警告を出して無効化
    if (requireApiKey && !apiKey) {
      logger.warn({ baseUrl }, 'API key not configured. Requests will fail');
      this.isConfigured = false;
    }
  }

  /**
   * APIクライアントが正しく設定されているかチェック
   */
  public isAvailable(): boolean {
    return this.isConfigured;
  }

  /**
   * 指数バックオフでのリトライ間隔を計算
   * @param attempt リトライ回数（0から開始）
   * @returns 待機時間（ミリ秒） Max 5000ms
   * 7回目以降は5000ms固定
   */
  private getBackoffDelay(attempt: number): number {
    // 100ms, 200ms, 400ms, ...
    return Math.min(100 * Math.pow(2, attempt), 5000);
  }

  /**
   * リトライ可能かどうかを判定
   * @param statusCode HTTPステータスコード
   * @param error エラーオブジェクト
   * @returns リトライ可能な場合は true
   */
  private isRetryable(statusCode?: number, error?: Error): boolean {
    if (!statusCode) {
      // ネットワークエラーの場合、リトライ可能
      return error instanceof TypeError && error.message.includes('fetch');
    }
    return RETRYABLE_STATUS_CODES.includes(statusCode);
  }

  /**
   * エラーレスポンスを詳細に解析
   */
  private async parseErrorResponse(response: Response): Promise<string> {
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        return data.message || data.error || `HTTP ${response.status}`;
      }
      return await response.text();
    } catch {
      return `HTTP ${response.status} ${response.statusText}`;
    }
  }

  /**
   * APIエラーを分類して ApiError インスタンスを作成
   */
  private createApiError(statusCode: number, message: string): ApiError {
    let type: ApiErrorType;
    let retryable = false;

    if (statusCode === 429) {
      type = ApiErrorType.RATE_LIMITED;
      retryable = true;
    } else if (RETRYABLE_STATUS_CODES.includes(statusCode)) {
      type = ApiErrorType.SERVER_ERROR;
      retryable = true;
    } else if (NON_RETRYABLE_STATUS_CODES.includes(statusCode)) {
      type = ApiErrorType.CLIENT_ERROR;
      retryable = false;
    } else {
      type = ApiErrorType.SERVER_ERROR;
      retryable = statusCode >= 500;
    }

    return new ApiError(message, type, statusCode, retryable);
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
    attempt: number = 0,
  ): Promise<T> {
    // APIクライアントが無効な場合、即座にエラーをスロー
    if (!this.isConfigured) {
      throw new ApiError(
        'API client is not configured. Please check your environment variables.',
        ApiErrorType.CLIENT_ERROR,
        undefined,
        false, // リトライ不可
      );
    }

    // キャッシング処理（最初のリクエストのみ）
    const { cache: cacheOptions, ...restOptions } = options;

    if (cacheOptions && attempt === 0) {
      const cacheKey =
        cacheOptions.key ||
        generateCacheKey(cacheOptions.prefix || 'api', restOptions.params || {});

      return (
        await withCache(cacheKey, cacheOptions.ttl, () =>
          this.request<T>(endpoint, restOptions, attempt),
        )
      ).data;
    }

    const timeout = restOptions.timeout ?? this.DEFAULT_TIMEOUT_MS;
    const maxRetries = restOptions.retries ?? this.DEFAULT_RETRIES;

    const { params, headers, ...rest } = restOptions;
    const url = new URL(`${this.baseUrl}${endpoint}`);

    // 既存のクエリパラメータを追加
    if (params) {
      Object.keys(params).forEach((key) => url.searchParams.append(key, params[key]));
    }

    // APIキーをクエリパラメータとして追加
    if (this.apiKey && this.keyLocation === 'query') {
      url.searchParams.append(this.keyName, this.apiKey);
    }

    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    // APIキーをヘッダーとして追加
    if (this.apiKey && this.keyLocation === 'header') {
      requestHeaders.set(this.keyName, this.apiKey);
    }

    try {
      // AbortController でタイムアウトを実装
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url.toString(), {
        headers: requestHeaders,
        signal: controller.signal,
        ...rest,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorMessage = await this.parseErrorResponse(response);
        const error = this.createApiError(response.status, errorMessage);

        // リトライ可能かつ、リトライ回数が残っている場合
        if (error.retryable && attempt < maxRetries) {
          const delay = this.getBackoffDelay(attempt);
          logger.warn(
            { endpoint, attempt: attempt + 1, maxRetries, delayMs: delay },
            'Retrying API request',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request<T>(endpoint, { ...restOptions, cache: cacheOptions }, attempt + 1);
        }

        throw error;
      }

      return response.json() as Promise<T>;
    } catch (error) {
      // タイムアウトの場合
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new ApiError(
          `Request timeout after ${timeout}ms`,
          ApiErrorType.TIMEOUT,
          undefined,
          true, // リトライ可能
        );

        // タイムアウトもリトライ対象
        if (attempt < maxRetries) {
          const delay = this.getBackoffDelay(attempt);
          logger.warn(
            { endpoint, attempt: attempt + 1, maxRetries, delayMs: delay, reason: 'timeout' },
            'Retrying API request after timeout',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request<T>(endpoint, { ...restOptions, cache: cacheOptions }, attempt + 1);
        }

        throw timeoutError;
      }

      // ネットワークエラー（fetch 失敗）
      if (error instanceof TypeError) {
        const networkError = new ApiError(
          `Network error: ${error.message}`,
          ApiErrorType.NETWORK_ERROR,
          undefined,
          this.isRetryable(undefined, error),
        );

        if (networkError.retryable && attempt < maxRetries) {
          const delay = this.getBackoffDelay(attempt);
          logger.warn(
            { endpoint, attempt: attempt + 1, maxRetries, delayMs: delay, reason: 'network_error' },
            'Retrying API request after network error',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request<T>(endpoint, { ...restOptions, cache: cacheOptions }, attempt + 1);
        }

        throw networkError;
      }

      // ApiError の場合はそのままスロー
      if (error instanceof ApiError) {
        throw error;
      }

      // 予期しないエラー
      throw new ApiError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        ApiErrorType.NETWORK_ERROR,
        undefined,
        false,
      );
    }
  }

  public get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  public post<T>(
    endpoint: string,
    data: Record<string, unknown> | unknown[],
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

// 各API用のクライアントインスタンスをエクスポート
// 環境変数からAPIキーを読み込む
export const openWeatherMapClient = new ApiClient(
  'https://api.openweathermap.org/data/2.5', // OpenWeatherMapのベースURL
  process.env.OPENWEATHERMAP_API_KEY || '',
  'query', // OpenWeatherMapはキーをクエリ(appid)で渡す
  'appid',
  true, // APIキー必須
);

export const googleMapsClient = new ApiClient(
  'https://maps.googleapis.com/maps/api', // Google MapsのベースURL
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  'query', // Google Maps APIはキーをクエリ(key)で渡す
  'key',
  true, // APIキー必須
);

// tide736.net のAPIクライアントインスタンスをエクスポート
export const tide736Client = new ApiClient(
  'https://tide736.net/api', // tide736.net のベースURL
  '',
  'query',
  '',
  false, // APIキー不要
);
