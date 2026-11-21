import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../logger', () => ({ logger: loggerMock }));

import { ApiClient } from './client';
import { ApiError, ApiErrorType } from './types';

// 期待値は docs/reference/api-error-handling.md から決める。
// 自動リトライは最大 3 回（合計 4 回呼ぶ）、遅延は 100・200・400ms、タイムアウトは 10 秒。
const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function httpError(status: number): Response {
  return new Response(JSON.stringify({ message: `status ${status}` }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function newClient() {
  return new ApiClient('https://example.test/api', 'secret', 'appid', true);
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const settled = promise.then(
    () => {
      throw new Error('resolved');
    },
    (e: unknown) => e,
  );
  await vi.runAllTimersAsync();
  const error = await settled;
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  loggerMock.warn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ApiClient のリトライ', () => {
  it.each([408, 500, 502, 503, 504])(
    '%i は 3 回リトライし、4 回目の失敗で投げる',
    async (status) => {
      fetchMock.mockImplementation(async () => httpError(status));

      const error = await failure(newClient().get('/x'));

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(error.statusCode).toBe(status);
      expect(error.retryable).toBe(true);
      // 408 は 4xx なので CLIENT_ERROR のまま、それでもリトライする（#389）
      expect(error.type).toBe(
        status === 408 ? ApiErrorType.CLIENT_ERROR : ApiErrorType.SERVER_ERROR,
      );
    },
  );

  it.each([400, 401, 403, 404, 429, 501, 505])('%i はリトライしない', async (status) => {
    fetchMock.mockImplementation(async () => httpError(status));

    const error = await failure(newClient().get('/x'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.statusCode).toBe(status);
    expect(error.retryable).toBe(false);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('408 のあとに成功すれば、その値を返す', async () => {
    fetchMock.mockResolvedValueOnce(httpError(408)).mockResolvedValueOnce(ok({ a: 1 }));

    const promise = newClient().get('/x');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('HTTP エラーのリトライは遅延をログに出す（100・200・400ms）', async () => {
    fetchMock.mockImplementation(async () => httpError(503));

    await failure(newClient().get('/x'));

    expect(loggerMock.warn.mock.calls).toEqual([
      [{ endpoint: '/x', attempt: 1, maxRetries: 3, delayMs: 100 }, 'Retrying API request'],
      [{ endpoint: '/x', attempt: 2, maxRetries: 3, delayMs: 200 }, 'Retrying API request'],
      [{ endpoint: '/x', attempt: 3, maxRetries: 3, delayMs: 400 }, 'Retrying API request'],
    ]);
  });

  it('遅延のあいだは次の呼び出しをしない', async () => {
    fetchMock.mockResolvedValueOnce(httpError(503)).mockResolvedValueOnce(ok({}));

    const promise = newClient().get('/x');
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await promise;
  });

  it('タイムアウトは 10 秒で打ち切り、リトライしたあと TIMEOUT を投げる', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    const error = await failure(newClient().get('/x'));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(error.type).toBe(ApiErrorType.TIMEOUT);
    expect(error.message).toBe('Request timeout after 10000ms');
    expect(error.retryable).toBe(true);
    expect(loggerMock.warn.mock.calls[0]).toEqual([
      { endpoint: '/x', attempt: 1, maxRetries: 3, delayMs: 100, reason: 'timeout' },
      'Retrying API request after timeout',
    ]);
  });

  it('メッセージに fetch を含む TypeError はネットワークエラーとしてリトライする', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await failure(newClient().get('/x'));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(error.type).toBe(ApiErrorType.NETWORK_ERROR);
    expect(error.message).toBe('Network error: fetch failed');
    expect(error.retryable).toBe(true);
    expect(loggerMock.warn.mock.calls[2]).toEqual([
      { endpoint: '/x', attempt: 3, maxRetries: 3, delayMs: 400, reason: 'network_error' },
      'Retrying API request after network error',
    ]);
  });

  it('fetch を含まない TypeError は NETWORK_ERROR だがリトライしない', async () => {
    fetchMock.mockRejectedValue(new TypeError('Invalid URL'));

    const error = await failure(newClient().get('/x'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.type).toBe(ApiErrorType.NETWORK_ERROR);
    expect(error.message).toBe('Network error: Invalid URL');
    expect(error.retryable).toBe(false);
  });

  it('想定外のエラーはリトライせず NETWORK_ERROR にする', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));

    const error = await failure(newClient().get('/x'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.type).toBe(ApiErrorType.NETWORK_ERROR);
    expect(error.message).toBe('Unexpected error: boom');
    expect(error.retryable).toBe(false);
  });
});

describe('ApiClient のリクエスト', () => {
  it('params と API キーをクエリに付ける', async () => {
    fetchMock.mockResolvedValue(ok({}));

    await newClient().get('/weather', { params: { lat: '35' } });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://example.test/api/weather');
    expect(url.searchParams.get('lat')).toBe('35');
    expect(url.searchParams.get('appid')).toBe('secret');
  });

  it('GET で JSON を要求する', async () => {
    fetchMock.mockResolvedValue(ok({}));

    await newClient().get('/x');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('キーが空で requireApiKey=false なら、キーを付けずに呼ぶ', async () => {
    fetchMock.mockResolvedValue(ok({}));
    const client = new ApiClient('https://example.test/api', '', '', false);

    await client.get('/x');

    expect(client.isAvailable()).toBe(true);
    expect(new URL(fetchMock.mock.calls[0][0] as string).search).toBe('');
  });

  it('キーが空で requireApiKey=true なら、fetch せずに CLIENT_ERROR を投げる', async () => {
    const client = new ApiClient('https://example.test/api', '', 'appid', true);

    const error = await failure(client.get('/x'));

    expect(client.isAvailable()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error.type).toBe(ApiErrorType.CLIENT_ERROR);
    expect(error.retryable).toBe(false);
  });
});
