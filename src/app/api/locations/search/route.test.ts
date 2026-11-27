import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  googleMapsClient: {
    isAvailable: vi.fn(),
    get: vi.fn(),
  },
}));
const cacheMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  ...apiMock,
}));
vi.mock('@/lib/cache/client', () => ({ cache: cacheMock }));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));
vi.mock('@/lib/rateLimit', () => ({
  withUserRateLimit: (_name: string, handler: () => unknown) => handler(),
}));

import { ApiErrorType } from '@/lib/api/types';
import { GET } from './route';

const UPSTREAM_SECRET = 'API key is invalid for project 12345';
const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;

const createRequest = (query = '東京湾') =>
  new NextRequest(`https://app.test/api/locations/search?q=${encodeURIComponent(query)}`);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  apiMock.googleMapsClient.isAvailable.mockReturnValue(true);
  cacheMock.get.mockResolvedValue({ hit: false });
  cacheMock.set.mockResolvedValue(true);
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.GOOGLE_MAPS_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
  }
});

// 根拠: docs/reference/api-error-handling.md「上流の応答が不正なとき」「エラーの分類と扱い」(#471)
describe('GET /api/locations/search の Geocoding ステータス処理 (#471)', () => {
  it('ZERO_RESULTS は 200 の 0 件応答を返し、エラーログを出さない', async () => {
    apiMock.googleMapsClient.get.mockResolvedValue({
      status: 'ZERO_RESULTS',
      results: [],
    });

    const response = await GET(createRequest('存在しない釣り場'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it.each([
    [
      'OVER_QUERY_LIMIT',
      ApiErrorType.RATE_LIMITED,
      false,
      'API の使用制限に達しました。数分後にお試しください。',
    ],
    [
      'REQUEST_DENIED',
      ApiErrorType.CLIENT_ERROR,
      false,
      '一時的に利用できません。時間をおいて再度お試しください。',
    ],
    [
      'INVALID_REQUEST',
      ApiErrorType.CLIENT_ERROR,
      false,
      '一時的に利用できません。時間をおいて再度お試しください。',
    ],
    [
      'UNKNOWN_ERROR',
      ApiErrorType.SERVER_ERROR,
      true,
      'サーバーで問題が発生しました。サポートに連絡してください。',
    ],
  ] as const)(
    'status=%s のとき 502 (code=%s) を返し、error_message を露出せず、API_ERROR ログを1回出し、キャッシュしない',
    async (status, expectedCode, expectedRetryable, expectedMessage) => {
      apiMock.googleMapsClient.get.mockResolvedValue({
        status,
        results: [],
        error_message: UPSTREAM_SECRET,
      });

      const response = await GET(createRequest('東京湾'));
      const rawBody = await response.text();
      const body = JSON.parse(rawBody);

      expect(response.status).toBe(502);
      expect(body).toEqual({
        error: expectedMessage,
        code: expectedCode,
        retryable: expectedRetryable,
      });
      expect(rawBody).not.toContain(UPSTREAM_SECRET);
      expect([...response.headers.values()].join('\n')).not.toContain(UPSTREAM_SECRET);

      // 仕様（二重ログを廃止し API_ERROR ログに一本化する）
      expect(loggerMock.error).toHaveBeenCalledTimes(1);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/api/locations/search',
          type: 'API_ERROR',
          errorType: expectedCode,
          retryable: expectedRetryable,
          message: expect.stringContaining(UPSTREAM_SECRET),
        }),
        'API request failed',
      );

      // 仕様（異常応答はキャッシュに保存しない: testing-policy 5節）
      expect(cacheMock.set).not.toHaveBeenCalled();
    },
  );
});
