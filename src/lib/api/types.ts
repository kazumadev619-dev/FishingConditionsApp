export enum ApiErrorType {
  TIMEOUT = 'TIMEOUT',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVER_ERROR = 'SERVER_ERROR',
  CLIENT_ERROR = 'CLIENT_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

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

export interface RequestOptions extends Omit<RequestInit, 'cache'> {
  params?: Record<string, string>;
  timeout?: number;
  retries?: number;
  cache?: {
    ttl: number;
    key?: string;
    prefix?: string;
  };
}

export const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
export const NON_RETRYABLE_STATUS_CODES = [400, 401, 403, 404];
