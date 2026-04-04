import { ApiError, ApiErrorType } from './apiClient';
import { logger } from './logger';

// ApiError インスタンスかどうかを判定
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// エラー型から日本語のメッセージを生成
export function getErrorMessage(error: ApiError): string {
  switch (error.type) {
    case ApiErrorType.TIMEOUT:
      return '通信がタイムアウトしました。インターネット接続を確認して、もう一度お試しください。';

    case ApiErrorType.RATE_LIMITED:
      return 'API の使用制限に達しました。数分後にお試しください。';

    case ApiErrorType.SERVER_ERROR:
      return 'サーバーで問題が発生しました。サポートに連絡してください。';

    case ApiErrorType.CLIENT_ERROR:
      return 'リクエストが無効です。入力内容を確認してください。';

    case ApiErrorType.NETWORK_ERROR:
      return 'ネットワーク接続を確認してください。';

    default:
      return 'エラーが発生しました。もう一度お試しください。';
  }
}

// リトライ可能かどうかを判定
export function isRetryable(error: ApiError): boolean {
  return error.retryable;
}

/**
 * エラーをログに記録（構造化ログ）
 */
export function logApiError(error: ApiError, context?: Record<string, unknown>): void {
  const logData = {
    type: 'API_ERROR',
    errorType: error.type,
    statusCode: error.statusCode,
    message: error.message,
    retryable: error.retryable,
    timestamp: new Date().toISOString(),
    ...context,
  };
  logger.error(logData, 'API request failed');
}

/**
 * リトライ可能なエラーの場合、待機して再試行する
 * （ApiClient の内部リトライが失敗した場合用）
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 100,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delay = initialDelay * 2 ** attempt;
        logger.warn({ attempt: attempt + 1, delayMs: delay }, 'Retry attempt failed, retrying...');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
