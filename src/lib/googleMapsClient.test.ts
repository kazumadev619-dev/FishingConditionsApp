import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  googleMapsClient: {
    isAvailable: vi.fn(),
    get: vi.fn(),
  },
}));
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/client')>()),
  ...apiMock,
}));
vi.mock('./logger', () => ({ logger: loggerMock }));

import { ApiError, ApiErrorType } from './api/types';
import { geocode } from './googleMapsClient';

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.googleMapsClient.isAvailable.mockReturnValue(true);
});

// 根拠: docs/reference/api-error-handling.md「上流の応答が不正なとき」および #471
describe('geocode のステータス分類とログ抑制（#471）', () => {
  it('status=OK はそのまま結果を返す', async () => {
    const okResponse = {
      status: 'OK',
      results: [{ place_id: 'p1', formatted_address: '東京都' }],
    };
    apiMock.googleMapsClient.get.mockResolvedValue(okResponse);

    const result = await geocode('東京');

    expect(result).toEqual(okResponse);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('status=ZERO_RESULTS はエラーにせず 0 件の正常応答として返す', async () => {
    const zeroResponse = {
      status: 'ZERO_RESULTS',
      results: [],
    };
    apiMock.googleMapsClient.get.mockResolvedValue(zeroResponse);

    const result = await geocode('存在しない場所');

    expect(result).toEqual(zeroResponse);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it.each([
    ['OVER_QUERY_LIMIT', ApiErrorType.RATE_LIMITED, false, undefined],
    ['REQUEST_DENIED', ApiErrorType.CLIENT_ERROR, false, undefined],
    ['INVALID_REQUEST', ApiErrorType.CLIENT_ERROR, false, undefined],
    ['UNKNOWN_ERROR', ApiErrorType.SERVER_ERROR, true, 502],
    ['UNEXPECTED_STATUS', ApiErrorType.SERVER_ERROR, true, 502],
  ] as const)(
    'status=%s を ApiError(type=%s, retryable=%s) に分類し、二重ログを出さない',
    async (status, expectedType, expectedRetryable, expectedStatusCode) => {
      apiMock.googleMapsClient.get.mockResolvedValue({
        status,
        results: [],
        error_message: 'secret upstream detail',
      });

      const error = await geocode('東京').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        type: expectedType,
        retryable: expectedRetryable,
        statusCode: expectedStatusCode,
        message: `Geocoding API error: ${status} - secret upstream detail`,
      });
      // 仕様（route.ts の createApiErrorResponse に一本化し、geocode 内で二重ログを出さない）
      expect(loggerMock.error).not.toHaveBeenCalled();
    },
  );

  it('googleMapsClient が未設定のときは ApiError(CLIENT_ERROR, retryable=false) を投げる', async () => {
    apiMock.googleMapsClient.isAvailable.mockReturnValue(false);

    const error = await geocode('東京').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      type: ApiErrorType.CLIENT_ERROR,
      retryable: false,
    });
    expect(apiMock.googleMapsClient.get).not.toHaveBeenCalled();
  });

  it('googleMapsClient.get が ApiError を投げた場合も二重ログを出さずそのまま伝播する', async () => {
    const upstreamError = new ApiError('Request timeout', ApiErrorType.TIMEOUT, undefined, true);
    apiMock.googleMapsClient.get.mockRejectedValue(upstreamError);

    const error = await geocode('東京').catch((e: unknown) => e);

    expect(error).toBe(upstreamError);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });
});
