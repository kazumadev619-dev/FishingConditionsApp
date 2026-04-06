import { RETRYABLE_STATUS_CODES } from './types';

export function getBackoffDelay(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 5000);
}

export function isRetryable(statusCode?: number, error?: Error): boolean {
  if (!statusCode) {
    return error instanceof TypeError && error.message.includes('fetch');
  }
  return RETRYABLE_STATUS_CODES.includes(statusCode);
}
