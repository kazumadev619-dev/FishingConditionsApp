import { logger } from '../logger';
import { createApiError, parseErrorResponse } from './errorHandler';
import { getBackoffDelay } from './retryStrategy';
import { ApiError, ApiErrorType, type RequestOptions } from './types';

class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private keyName: string;
  private isConfigured: boolean = true;

  private readonly TIMEOUT_MS = 10000;
  private readonly MAX_RETRIES = 3;

  // API キーはクエリで渡す（3 つのクライアントすべてがそう使っている）
  constructor(baseUrl: string, apiKey: string, keyName: string, requireApiKey: boolean = true) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.keyName = keyName;

    if (requireApiKey && !apiKey) {
      logger.warn({ baseUrl }, 'API key not configured. Requests will fail');
      this.isConfigured = false;
    }
  }

  public isAvailable(): boolean {
    return this.isConfigured;
  }

  private async request<T>(
    endpoint: string,
    params?: Record<string, string>,
    attempt: number = 0,
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new ApiError(
        'API client is not configured. Please check your environment variables.',
        ApiErrorType.CLIENT_ERROR,
        undefined,
        false,
      );
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (params) {
      // biome-ignore lint/suspicious/useIterableCallbackReturn: void return is intentional for forEach side effect
      Object.keys(params).forEach((key) => url.searchParams.append(key, params[key]));
    }

    if (this.apiKey) {
      url.searchParams.append(this.keyName, this.apiKey);
    }

    // リトライできる失敗なら、遅延をログに出して待ち、同じ request をやり直す。
    // できなければ error を投げる。
    const retryOrThrow = async (
      error: ApiError,
      log: { reason?: string; message: string },
    ): Promise<T> => {
      if (!error.retryable || attempt >= this.MAX_RETRIES) {
        throw error;
      }
      const delay = getBackoffDelay(attempt);
      logger.warn(
        {
          endpoint,
          attempt: attempt + 1,
          maxRetries: this.MAX_RETRIES,
          delayMs: delay,
          ...(log.reason && { reason: log.reason }),
        },
        log.message,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.request<T>(endpoint, params, attempt + 1);
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response);
        return await retryOrThrow(createApiError(response.status, errorMessage), {
          message: 'Retrying API request',
        });
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return retryOrThrow(
          new ApiError(
            `Request timeout after ${this.TIMEOUT_MS}ms`,
            ApiErrorType.TIMEOUT,
            undefined,
            true,
          ),
          { reason: 'timeout', message: 'Retrying API request after timeout' },
        );
      }

      if (error instanceof TypeError) {
        return retryOrThrow(
          new ApiError(
            `Network error: ${error.message}`,
            ApiErrorType.NETWORK_ERROR,
            undefined,
            error.message.includes('fetch'),
          ),
          { reason: 'network_error', message: 'Retrying API request after network error' },
        );
      }

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        ApiErrorType.NETWORK_ERROR,
        undefined,
        false,
      );
    }
  }

  public get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, options?.params);
  }
}

export const openWeatherMapClient = new ApiClient(
  'https://api.openweathermap.org/data/2.5',
  process.env.OPENWEATHERMAP_API_KEY || '',
  'appid',
  true,
);

// サーバー専用キー。NEXT_PUBLIC_ を付けてはいけない。付けるとビルド時に
// クライアントバンドルへインライン化され、ブラウザ用キーと同じく第三者から
// 取り出せる状態に戻る（#143）。Geocoding はサーバーからしか呼ばないため
// Referer が付かず、ブラウザ用キーのリファラ制限とは両立しない。
export const googleMapsClient = new ApiClient(
  'https://maps.googleapis.com/maps/api',
  process.env.GOOGLE_MAPS_API_KEY || '',
  'key',
  true,
);

export const tide736Client = new ApiClient('https://tide736.net/api', '', '', false);

export { ApiClient };
