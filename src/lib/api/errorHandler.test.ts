import { describe, expect, it } from 'vitest';
import { createApiError } from './errorHandler';
import { isRetryable } from './retryStrategy';
import { ApiErrorType } from './types';

describe('上流の 429', () => {
  it('リトライしない', () => {
    expect(createApiError(429, 'rate limited').retryable).toBe(false);
    expect(isRetryable(429)).toBe(false);
  });

  it('503 はこれまでどおりリトライする', () => {
    expect(createApiError(503, 'unavailable').retryable).toBe(true);
    expect(isRetryable(503)).toBe(true);
  });
});

// 期待値は docs/reference/api-error-handling.md から決める。
// 種別は 4xx が CLIENT_ERROR・5xx が SERVER_ERROR（429 だけ RATE_LIMITED）。
// リトライするのは 408/500/502/503/504 だけ。
describe('createApiError の分類', () => {
  it.each([
    [400, ApiErrorType.CLIENT_ERROR, false],
    [404, ApiErrorType.CLIENT_ERROR, false],
    [405, ApiErrorType.CLIENT_ERROR, false],
    [409, ApiErrorType.CLIENT_ERROR, false],
    [422, ApiErrorType.CLIENT_ERROR, false],
    [408, ApiErrorType.CLIENT_ERROR, true],
    [500, ApiErrorType.SERVER_ERROR, true],
    [502, ApiErrorType.SERVER_ERROR, true],
    [503, ApiErrorType.SERVER_ERROR, true],
    [504, ApiErrorType.SERVER_ERROR, true],
    [501, ApiErrorType.SERVER_ERROR, false],
    [505, ApiErrorType.SERVER_ERROR, false],
  ])('%i は %s・retryable=%s', (status, type, retryable) => {
    const error = createApiError(status, 'msg');
    expect(error.type).toBe(type);
    expect(error.retryable).toBe(retryable);
    expect(isRetryable(status)).toBe(retryable);
  });

  it('429 は RATE_LIMITED', () => {
    expect(createApiError(429, 'msg').type).toBe(ApiErrorType.RATE_LIMITED);
  });
});
