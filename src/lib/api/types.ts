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

export interface RequestOptions {
  params?: Record<string, string>;
}

// 429 は入れない。絞られている上流を叩き直すと呼び出しが増えるだけ
export const RETRYABLE_STATUS_CODES = [408, 500, 502, 503, 504];
