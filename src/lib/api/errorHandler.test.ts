import { describe, expect, it } from 'vitest';
import { createApiError } from './errorHandler';
import { isRetryable } from './retryStrategy';

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
