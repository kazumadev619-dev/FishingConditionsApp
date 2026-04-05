import { generateCacheKey, withCache } from '../cache';
import { logger } from '../logger';
import { createApiError, parseErrorResponse } from './errorHandler';
import { getBackoffDelay, isRetryable } from './retryStrategy';
import { ApiError, ApiErrorType, type RequestOptions } from './types';

class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private keyLocation: 'query' | 'header';
  private keyName: string;
  private isConfigured: boolean = true;

  private readonly DEFAULT_TIMEOUT_MS = 10000;
  private readonly DEFAULT_RETRIES = 3;

  constructor(
    baseUrl: string,
    apiKey: string,
    keyLocation: 'query' | 'header' = 'header',
    keyName: string = 'X-API-Key',
    requireApiKey: boolean = true,
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.keyLocation = keyLocation;
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
    options: RequestOptions = {},
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

    if (params) {
      // biome-ignore lint/suspicious/useIterableCallbackReturn: void return is intentional for forEach side effect
      Object.keys(params).forEach((key) => url.searchParams.append(key, params[key]));
    }

    if (this.apiKey && this.keyLocation === 'query') {
      url.searchParams.append(this.keyName, this.apiKey);
    }

    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    if (this.apiKey && this.keyLocation === 'header') {
      requestHeaders.set(this.keyName, this.apiKey);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url.toString(), {
        headers: requestHeaders,
        signal: controller.signal,
        ...rest,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorMessage = await parseErrorResponse(response);
        const error = createApiError(response.status, errorMessage);

        if (error.retryable && attempt < maxRetries) {
          const delay = getBackoffDelay(attempt);
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
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new ApiError(
          `Request timeout after ${timeout}ms`,
          ApiErrorType.TIMEOUT,
          undefined,
          true,
        );

        if (attempt < maxRetries) {
          const delay = getBackoffDelay(attempt);
          logger.warn(
            { endpoint, attempt: attempt + 1, maxRetries, delayMs: delay, reason: 'timeout' },
            'Retrying API request after timeout',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request<T>(endpoint, { ...restOptions, cache: cacheOptions }, attempt + 1);
        }

        throw timeoutError;
      }

      if (error instanceof TypeError) {
        const networkError = new ApiError(
          `Network error: ${error.message}`,
          ApiErrorType.NETWORK_ERROR,
          undefined,
          isRetryable(undefined, error),
        );

        if (networkError.retryable && attempt < maxRetries) {
          const delay = getBackoffDelay(attempt);
          logger.warn(
            { endpoint, attempt: attempt + 1, maxRetries, delayMs: delay, reason: 'network_error' },
            'Retrying API request after network error',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.request<T>(endpoint, { ...restOptions, cache: cacheOptions }, attempt + 1);
        }

        throw networkError;
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

export const openWeatherMapClient = new ApiClient(
  'https://api.openweathermap.org/data/2.5',
  process.env.OPENWEATHERMAP_API_KEY || '',
  'query',
  'appid',
  true,
);

export const googleMapsClient = new ApiClient(
  'https://maps.googleapis.com/maps/api',
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  'query',
  'key',
  true,
);

export const tide736Client = new ApiClient(
  'https://tide736.net/api',
  '',
  'query',
  '',
  false,
);

export { ApiClient };
