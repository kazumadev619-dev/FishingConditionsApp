import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { createApiError } from '@/lib/api/errorHandler';
import { ApiError, ApiErrorType } from '@/lib/api/types';
import { isLocationSearchConfigured, searchLocations } from '@/lib/locationService';
import { logger } from '@/lib/logger';
import { getCurrentWeather, getForecast, isWeatherApiConfigured } from '@/lib/openWeatherService';
import prisma from '@/lib/prisma';
import { getTideData } from '@/lib/tideService';
import { GET as tide } from './conditions/tide/route';
import { DELETE as deleteFavorite } from './favorites/handlers/deleteFavorite';
import { GET as getFavorites } from './favorites/handlers/getFavorites';
import { POST as addFavorite } from './favorites/route';
import { GET as locationSearch } from './locations/search/route';
import { GET as ports } from './ports/route';
import { GET as scores } from './scores/route';
import { GET as weather } from './weather/route';

const userId = '11111111-1111-4111-8111-111111111111';

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: userId } }) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    ports: { findMany: vi.fn(), findUnique: vi.fn() },
    user_favorites: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/rateLimit', () => ({
  withUserRateLimit: (_name: string, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/locationService', () => ({
  isLocationSearchConfigured: vi.fn(() => true),
  searchLocations: vi.fn(),
}));
vi.mock('@/lib/openWeatherService', () => ({
  isWeatherApiConfigured: vi.fn(() => true),
  getCurrentWeather: vi.fn(),
  getForecast: vi.fn(),
}));
vi.mock('@/lib/tideService', () => ({ getTideData: vi.fn() }));

const SECRET = "Can't reach database server at db.internal:5432";

const request = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`https://app.test${url}`, init);

const scoresUrl =
  '/api/scores?lat=35.6&lon=139.7&prefectureCode=13&portCode=2&date=2026-11-01&skipCache=true';

/** pino が Error を展開するキーだけを見る。ほかのキーで渡すと `{}` になり理由が残らない（#294） */
const loggedErrors = () =>
  vi.mocked(logger.error).mock.calls.flatMap(([meta]) => {
    const { error, err } = meta as { error?: unknown; err?: unknown };
    return [error, err];
  });

const loggedMetaTypes = () =>
  vi
    .mocked(logger.error)
    .mock.calls.map(([meta]) => (meta as { type?: unknown } | undefined)?.type);

const expectNotInHeaders = (response: Response) =>
  expect([...response.headers.values()].join('\n')).not.toContain(SECRET);

afterEach(() => vi.clearAllMocks());

describe('失敗の応答に例外の message を入れない（#313）', () => {
  it.each([
    [
      'ports',
      () => vi.mocked(prisma.ports.findMany),
      () => ports(request('/api/ports')),
      { error: '港情報の取得に失敗しました' },
    ],
    [
      'favorites GET',
      () => vi.mocked(prisma.user_favorites.findMany),
      () => getFavorites(),
      { error: 'Failed to fetch favorites' },
    ],
    [
      'favorites POST',
      () => vi.mocked(prisma.user_favorites.create),
      () =>
        addFavorite(
          request('/api/favorites', {
            method: 'POST',
            body: JSON.stringify({ locationId: userId }),
          }),
        ),
      { error: 'Failed to add favorite' },
    ],
    [
      'favorites DELETE',
      () => vi.mocked(prisma.user_favorites.deleteMany),
      () => deleteFavorite(request(`/api/favorites?locationId=${userId}`, { method: 'DELETE' })),
      { error: 'Failed to delete favorite' },
    ],
    [
      'scores',
      () => vi.mocked(getCurrentWeather),
      () => scores(request(scoresUrl)),
      { error: 'Failed to calculate fishing score' },
    ],
    [
      'locations/search',
      () => vi.mocked(searchLocations),
      () => locationSearch(request('/api/locations/search?q=tokyo')),
      { error: 'Failed to search locations', status: 500 },
    ],
    [
      'conditions/tide',
      () => vi.mocked(getTideData),
      () => tide(request('/api/conditions/tide?prefectureCode=13&portCode=2')),
      { error: 'Failed to fetch tide data', status: 500 },
    ],
  ] as const)(
    '%s の 500 は固定の文言を返し、詳細はログに残す',
    async (_name, dependency, call, body) => {
      const thrown = new Error(SECRET);
      dependency().mockRejectedValue(thrown as never);

      const response = await call();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual(body);
      expectNotInHeaders(response);
      expect(loggedErrors()).toContain(thrown);
      expect(loggedMetaTypes()).not.toContain('API_ERROR');
      expect(loggedMetaTypes()).not.toContain('DB_ERROR');
    },
  );

  // 根拠: docs/reference/api-error-handling.md「エラーの分類と扱い」（#428）
  // 異常なエラー（上流の 4xx・429・5xx・通信断は 502、タイムアウトは 504）を
  // 想定外のエラー（500）と区別し、上流の応答本文はレスポンスに含めない。
  describe('上流 API 障害の分類（#428）', () => {
    const upstreamCases: ReadonlyArray<
      readonly [string, 502 | 504, ApiError, string, boolean, ApiErrorType]
    > = [
      [
        'SERVER_ERROR',
        502,
        createApiError(503, SECRET),
        'サーバーで問題が発生しました。サポートに連絡してください。',
        true,
        ApiErrorType.SERVER_ERROR,
      ],
      [
        'SERVER_ERROR (upstream 504)',
        502,
        createApiError(504, SECRET),
        'サーバーで問題が発生しました。サポートに連絡してください。',
        true,
        ApiErrorType.SERVER_ERROR,
      ],
      [
        'CLIENT_ERROR (401)',
        502,
        createApiError(401, SECRET),
        'リクエストが無効です。入力内容を確認してください。',
        false,
        ApiErrorType.CLIENT_ERROR,
      ],
      [
        'CLIENT_ERROR (422)',
        502,
        createApiError(422, SECRET),
        'リクエストが無効です。入力内容を確認してください。',
        false,
        ApiErrorType.CLIENT_ERROR,
      ],
      [
        'RATE_LIMITED',
        502,
        createApiError(429, SECRET),
        'API の使用制限に達しました。数分後にお試しください。',
        false,
        ApiErrorType.RATE_LIMITED,
      ],
      [
        'TIMEOUT',
        504,
        new ApiError(SECRET, ApiErrorType.TIMEOUT, undefined, true),
        '通信がタイムアウトしました。インターネット接続を確認して、もう一度お試しください。',
        true,
        ApiErrorType.TIMEOUT,
      ],
      [
        'NETWORK_ERROR',
        502,
        new ApiError(SECRET, ApiErrorType.NETWORK_ERROR, undefined, true),
        'ネットワーク接続を確認してください。',
        true,
        ApiErrorType.NETWORK_ERROR,
      ],
    ];

    const upstreamRoutes = [
      [
        'weather',
        () => vi.mocked(getCurrentWeather),
        () => weather(request('/api/weather?lat=35.6&lon=139.7')),
        true,
      ],
      [
        'weather (forecast)',
        () => vi.mocked(getForecast),
        () => weather(request('/api/weather?lat=35.6&lon=139.7&type=forecast')),
        true,
      ],
      ['scores', () => vi.mocked(getCurrentWeather), () => scores(request(scoresUrl)), false],
      [
        'locations/search',
        () => vi.mocked(searchLocations),
        () => locationSearch(request('/api/locations/search?q=tokyo')),
        false,
      ],
      [
        'conditions/tide',
        () => vi.mocked(getTideData),
        () => tide(request('/api/conditions/tide?prefectureCode=13&portCode=2')),
        false,
      ],
    ] as const;

    describe.each(upstreamRoutes)('%s', (_routeName, dependency, call, hasSuccessField) => {
      it.each(upstreamCases)(
        '%s は HTTP %i と固定文言を返し、API_ERROR として記録する',
        async (_label, status, thrown, error, retryable, code) => {
          dependency().mockRejectedValue(thrown as never);

          const response = await call();

          expect(response.status).toBe(status);
          const expectedBody = hasSuccessField
            ? { success: false, error, code, retryable }
            : { error, code, retryable };
          await expect(response.json()).resolves.toEqual(expectedBody);
          expectNotInHeaders(response);
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'API_ERROR',
              errorType: code,
              message: SECRET,
            }),
            'API request failed',
          );
        },
      );
    });

    it('weather (forecast) は weatherType: forecast を付けて API_ERROR を記録し、想定外は 500 を返す', async () => {
      vi.mocked(getForecast).mockRejectedValueOnce(createApiError(502, SECRET));

      const apiErrRes = await weather(request('/api/weather?lat=35.6&lon=139.7&type=forecast'));
      expect(apiErrRes.status).toBe(502);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'API_ERROR',
          weatherType: 'forecast',
          endpoint: '/api/weather',
        }),
        'API request failed',
      );

      vi.clearAllMocks();
      const thrown = new Error(SECRET);
      vi.mocked(getForecast).mockRejectedValueOnce(thrown);

      const unexpectedRes = await weather(request('/api/weather?lat=35.6&lon=139.7&type=forecast'));
      expect(unexpectedRes.status).toBe(500);
      expect(loggedErrors()).toContain(thrown);
      expect(loggedMetaTypes()).not.toContain('API_ERROR');
    });

    it('API キー未設定（weather / locations/search）は 503 と固定文言を返し、warn ではなく error ログを出す', async () => {
      vi.mocked(isWeatherApiConfigured).mockReturnValueOnce(false);
      const weatherRes = await weather(request('/api/weather?lat=35.6&lon=139.7'));
      expect(weatherRes.status).toBe(503);
      await expect(weatherRes.json()).resolves.toEqual({
        error: 'Weather API is not configured',
        code: 'API_NOT_CONFIGURED',
        status: 503,
      });
      expect(logger.error).toHaveBeenCalledWith('OPENWEATHERMAP_API_KEY is not configured');

      vi.mocked(isLocationSearchConfigured).mockReturnValueOnce(false);
      const locationRes = await locationSearch(request('/api/locations/search?q=tokyo'));
      expect(locationRes.status).toBe(503);
      await expect(locationRes.json()).resolves.toEqual({
        error: 'Location search is not configured. Please set GOOGLE_MAPS_API_KEY.',
        status: 503,
      });
      expect(logger.error).toHaveBeenCalledWith('GOOGLE_MAPS_API_KEY is not configured');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('weather の自前の ApiError でない例外は 500 の固定文言で返す', async () => {
      const thrown = new Error(SECRET);
      vi.mocked(getCurrentWeather).mockRejectedValue(thrown);

      const response = await weather(request('/api/weather?lat=35.6&lon=139.7'));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: '天気データの取得中にエラーが発生しました',
        code: 'INTERNAL_ERROR',
      });
      expectNotInHeaders(response);
      expect(loggedErrors()).toContain(thrown);
      expect(loggedMetaTypes()).not.toContain('API_ERROR');
    });
  });

  // 根拠: docs/reference/api-error-handling.md「エラーの分類と扱い」および #428
  // Prisma の接続・到達不能エラーは 503 と DB_ERROR で返し、想定外（500）と区別する。
  // error.meta の形はアダプタで変わるため（#161）、meta を持たないエラーでも判定できること。
  describe('DB 障害の分類（#428）', () => {
    const knownDbError = (code: string) =>
      new Prisma.PrismaClientKnownRequestError(SECRET, {
        code,
        clientVersion: '7.10.1',
      });

    const dbRoutes = [
      [
        'ports',
        () => vi.mocked(prisma.ports.findMany),
        () => ports(request('/api/ports')),
        '港情報の取得に失敗しました',
      ],
      [
        'favorites GET',
        () => vi.mocked(prisma.user_favorites.findMany),
        () => getFavorites(),
        'Failed to fetch favorites',
      ],
      [
        'favorites POST (create)',
        () => vi.mocked(prisma.user_favorites.create),
        () =>
          addFavorite(
            request('/api/favorites', {
              method: 'POST',
              body: JSON.stringify({ locationId: userId }),
            }),
          ),
        'Failed to add favorite',
      ],
      [
        'favorites POST (resolveLocationId)',
        () => vi.mocked(prisma.ports.findUnique),
        () =>
          addFavorite(
            request('/api/favorites', {
              method: 'POST',
              body: JSON.stringify({ portId: userId }),
            }),
          ),
        'Failed to add favorite',
      ],
      [
        'favorites DELETE',
        () => vi.mocked(prisma.user_favorites.deleteMany),
        () => deleteFavorite(request(`/api/favorites?locationId=${userId}`, { method: 'DELETE' })),
        'Failed to delete favorite',
      ],
    ] as const;

    describe.each(dbRoutes)('%s', (_routeName, dependency, call, unexpectedMessage) => {
      it.each(['P1001', 'P1008', 'P1017', 'P2024', 'P2037'])(
        '接続エラー %s は 503 と DB_ERROR を返し、詳細を漏らさない',
        async (code) => {
          const thrown = knownDbError(code);
          dependency().mockRejectedValue(thrown as never);

          const response = await call();

          expect(response.status).toBe(503);
          await expect(response.json()).resolves.toEqual({
            error: '一時的に利用できません。時間をおいて再度お試しください。',
            code: 'DB_UNAVAILABLE',
          });
          expectNotInHeaders(response);
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DB_ERROR', code, err: thrown }),
            'Database request failed',
          );
          expect(logger.error).not.toHaveBeenCalledWith(
            expect.anything(),
            'Unhandled Prisma error code',
          );
        },
      );

      it('PrismaClientInitializationError は 503 と DB_ERROR を返す', async () => {
        const thrown = new Prisma.PrismaClientInitializationError(SECRET, '7.10.1', 'P1001');
        dependency().mockRejectedValue(thrown as never);

        const response = await call();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          error: '一時的に利用できません。時間をおいて再度お試しください。',
          code: 'DB_UNAVAILABLE',
        });
        expectNotInHeaders(response);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'DB_ERROR', code: 'P1001', err: thrown }),
          'Database request failed',
        );
      });

      it('errorCode の無い PrismaClientInitializationError でも 503 と DB_ERROR を返す', async () => {
        const thrown = new Prisma.PrismaClientInitializationError(SECRET, '7.10.1');
        dependency().mockRejectedValue(thrown as never);

        const response = await call();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
          error: '一時的に利用できません。時間をおいて再度お試しください。',
          code: 'DB_UNAVAILABLE',
        });
        expectNotInHeaders(response);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'DB_ERROR', err: thrown }),
          'Database request failed',
        );
      });

      it('接続エラーでない Prisma 例外（P2025）は 500（想定外）になる', async () => {
        const thrown = knownDbError('P2025');
        dependency().mockRejectedValue(thrown as never);

        const response = await call();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: unexpectedMessage });
        expectNotInHeaders(response);
        expect(loggedMetaTypes()).not.toContain('DB_ERROR');
      });

      it('実物の @prisma/adapter-pg / pg 接続障害（ECONNREFUSED・pg タイムアウト・P2039 57P01）も 503 と DB_ERROR になり、P2039 42601（構文エラー）は 500 になる', async () => {
        for (const dbErr of [
          knownDbError('ECONNREFUSED'),
          new Error('Connection terminated due to connection timeout'),
          new Prisma.PrismaClientKnownRequestError(
            'Database error. Code: `57P01`. Message: `terminating connection`',
            { code: 'P2039', clientVersion: '7.10.1' },
          ),
        ]) {
          vi.clearAllMocks();
          dependency().mockRejectedValue(dbErr as never);

          const res = await call();

          expect(res.status).toBe(503);
          expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'DB_ERROR', err: dbErr }),
            'Database request failed',
          );
        }

        vi.clearAllMocks();
        const syntaxErr = new Prisma.PrismaClientKnownRequestError(
          'Database error. Code: `42601`. Message: `syntax error`',
          { code: 'P2039', clientVersion: '7.10.1' },
        );
        dependency().mockRejectedValue(syntaxErr as never);

        const unexpectedRes = await call();
        expect(unexpectedRes.status).toBe(500);
        expect(loggedMetaTypes()).not.toContain('DB_ERROR');
      });
    });

    // addFavorite.ts の既存既知エラー分岐（P2002 / P2003）が DB 障害判定追加で壊れていないこと
    describe('favorites POST の既知制約エラー（P2002 / P2003）は従来どおり 409 / 401 / 404 を返す', () => {
      it('P2002（重複登録）は 409 と locationId を返し、warn ログを残す', async () => {
        vi.mocked(prisma.user_favorites.create).mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the constraint: `user_favorites_user_id_location_id_key`',
            { code: 'P2002', clientVersion: '7.10.1' },
          ),
        );

        const response = await addFavorite(
          request('/api/favorites', {
            method: 'POST',
            body: JSON.stringify({ locationId: userId }),
          }),
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
          error: 'Already added to favorites',
          locationId: userId,
        });
        expect(logger.warn).toHaveBeenCalledWith(
          { locationId: userId },
          'POST favorites: already in favorites',
        );
      });

      it('P2003（user_favorites_user_id_fkey 違反）は 401 を返す', async () => {
        vi.mocked(prisma.user_favorites.create).mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError(
            'Foreign key constraint violated on the constraint: `user_favorites_user_id_fkey`',
            { code: 'P2003', clientVersion: '7.10.1' },
          ),
        );

        const response = await addFavorite(
          request('/api/favorites', {
            method: 'POST',
            body: JSON.stringify({ locationId: userId }),
          }),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: 'User not found' });
      });

      it('P2003（location_id 外部キー違反）は 404 を返す', async () => {
        vi.mocked(prisma.user_favorites.create).mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError(
            'Foreign key constraint violated on the constraint: `user_favorites_location_id_fkey`',
            { code: 'P2003', clientVersion: '7.10.1' },
          ),
        );

        const response = await addFavorite(
          request('/api/favorites', {
            method: 'POST',
            body: JSON.stringify({ locationId: userId }),
          }),
        );

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Location not found' });
      });
    });
  });
});
