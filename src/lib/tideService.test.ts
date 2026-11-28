import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ tide736Client: { get: vi.fn() } }));
const cacheMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock('./cache/client', () => ({ cache: cacheMock }));
vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/client')>()),
  ...apiMock,
}));

import { ApiError, ApiErrorType } from './api/types';
import { getTideData } from './tideService';

const validTideResponse = {
  status: 1,
  message: 'OK',
  tide: {
    port: {
      prefecture_code: 13,
      harbor_code: 1,
      harbor_namej: '東京',
    },
    chart: {
      '2026-10-12': {
        sun: {
          astro_twilight: ['04:15', '18:35'],
          regular_twilight: ['05:15', '17:35'],
          rise: '05:45',
          midline: '11:25',
          set: '17:05',
        },
        moon: {
          brightness: '50.0',
          age: '7.0',
          title: '小潮',
          rise: '12:00',
          midline: '17:30',
          set: '23:00',
          name: null,
        },
        tide: [],
        flood: [],
        edd: [],
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  cacheMock.get.mockResolvedValue({ hit: false });
  cacheMock.set.mockResolvedValue(true);
});

// 根拠: docs/reference/api-error-handling.md「エラーの分類と扱い」および #428
// tide736 が status !== 1 を返した場合は上流障害（ApiError）として扱い、キャッシュに保存しない
describe('getTideData のエラー分類（#428）', () => {
  it.each([
    ['0', 0],
    ['2', 2],
    ['-1', -1],
    ["'1'（文字列）", '1'],
    ['undefined', undefined],
  ])(
    'tide736 が status=%s（!== 1）を返したら ApiError(502, SERVER_ERROR) を投げ、キャッシュしない',
    async (_label, status) => {
      apiMock.tide736Client.get.mockResolvedValue({
        status,
        message: 'secret upstream failure',
      });

      const error = await getTideData('13', '1', '2026-10-12').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        type: ApiErrorType.SERVER_ERROR,
        statusCode: 502,
        retryable: true,
        message: 'tide736 API Error: secret upstream failure',
      });
      // 仕様（失敗応答をキャッシュしない）の確認のため呼び出し不在を検証（testing-policy 5節）
      expect(cacheMock.set).not.toHaveBeenCalled();
    },
  );

  it('skipCache: true でも status !== 1 なら ApiError(502) を投げ、キャッシュしない', async () => {
    apiMock.tide736Client.get.mockResolvedValue({
      status: 0,
      message: 'secret upstream failure',
    });

    const error = await getTideData('13', '1', '2026-10-12', { skipCache: true }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      type: ApiErrorType.SERVER_ERROR,
      statusCode: 502,
      retryable: true,
    });
    expect(cacheMock.set).not.toHaveBeenCalled();
  });

  it('キャッシュミスで status !== 1 失敗直後でも、次の status === 1 は正常取得してキャッシュ保存する', async () => {
    apiMock.tide736Client.get
      .mockResolvedValueOnce({ status: 0, message: 'temporary failure' })
      .mockResolvedValueOnce(validTideResponse);

    await expect(getTideData('13', '1', '2026-10-12')).rejects.toBeInstanceOf(ApiError);
    expect(cacheMock.set).not.toHaveBeenCalled();

    const result = await getTideData('13', '1', '2026-10-12');

    expect(result.data.port.port_name).toBe('東京');
    expect(cacheMock.set).toHaveBeenCalledOnce();
  });

  it('tide736Client が投げた ApiError をそのまま伝播し、キャッシュしない', async () => {
    const upstreamError = new ApiError(
      'Request timeout after 10000ms',
      ApiErrorType.TIMEOUT,
      undefined,
      true,
    );
    apiMock.tide736Client.get.mockRejectedValue(upstreamError);

    const error = await getTideData('13', '1', '2026-10-12').catch((e: unknown) => e);

    expect(error).toBe(upstreamError);
    expect(cacheMock.set).not.toHaveBeenCalled();
  });

  it('status === 1 の正常応答は整形して返し、キャッシュに保存する', async () => {
    apiMock.tide736Client.get.mockResolvedValue(validTideResponse);

    const result = await getTideData('13', '1', '2026-10-12');

    expect(result.data.port).toEqual({
      prefecture_code: '13',
      port_code: '1',
      port_name: '東京',
    });
    expect(result.data.tides).toHaveLength(1);
    expect(result.data.tides[0].date).toBe('2026-10-12');
    expect(cacheMock.set).toHaveBeenCalledOnce();
  });

  // 根拠: #473（null / 非オブジェクト応答を TypeError(500) ではなく ApiError(502) として分類する）
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'invalid response'],
    ['数値', 123],
    ['真偽値', true],
    ['配列', []],
  ])(
    'tide736 が非オブジェクト（%s）を返したら ApiError(502, SERVER_ERROR) を投げ、キャッシュしない',
    async (_label, rawResponse) => {
      apiMock.tide736Client.get.mockResolvedValue(rawResponse);

      const error = await getTideData('13', '1', '2026-10-12').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        type: ApiErrorType.SERVER_ERROR,
        statusCode: 502,
        retryable: true,
        message: 'tide736 API Error: Invalid response format',
      });
      expect(cacheMock.set).not.toHaveBeenCalled();
    },
  );

  // 根拠: #473（withCache による同時並列リクエスト中に上流失敗が起きたときの回復経路）
  it('同時並列リクエスト中に上流失敗しても全リクエストが ApiError で失敗し、後続リクエストで回復・キャッシュ保存できる', async () => {
    const upstreamDeferred = Promise.withResolvers<unknown>();
    apiMock.tide736Client.get
      .mockReturnValueOnce(upstreamDeferred.promise)
      .mockResolvedValueOnce(validTideResponse);

    const req1 = getTideData('13', '1', '2026-10-12');
    const req2 = getTideData('13', '1', '2026-10-12');

    upstreamDeferred.resolve(null);

    const [error1, error2] = await Promise.all([
      req1.catch((e: unknown) => e),
      req2.catch((e: unknown) => e),
    ]);

    expect(error1).toBeInstanceOf(ApiError);
    expect(error1).toMatchObject({
      type: ApiErrorType.SERVER_ERROR,
      statusCode: 502,
    });
    expect(error2).toBe(error1);
    // 仕様（同時並列の相乗りにより上流呼び出しは1回、失敗応答はキャッシュしない: testing-policy 5節）
    expect(apiMock.tide736Client.get).toHaveBeenCalledTimes(1);
    expect(cacheMock.set).not.toHaveBeenCalled();

    // inFlight が解放されているため、次のリクエストで再取得して回復しキャッシュ保存できる
    const recovered = await getTideData('13', '1', '2026-10-12');
    expect(recovered.data.port.port_name).toBe('東京');
    expect(apiMock.tide736Client.get).toHaveBeenCalledTimes(2);
    expect(cacheMock.set).toHaveBeenCalledOnce();
  });
});
