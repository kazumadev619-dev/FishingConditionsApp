import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiError } from '@/lib/api/errorHandler';
import { ApiError, ApiErrorType } from '@/lib/apiClient';
import { searchLocations } from '@/lib/locationService';
import { logger } from '@/lib/logger';
import { getCurrentWeather } from '@/lib/openWeatherService';
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
    ports: { findMany: vi.fn() },
    user_favorites: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/rateLimit', () => ({
  withUserRateLimit: (_name: string, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/locationService', () => ({
  isLocationSearchConfigured: () => true,
  searchLocations: vi.fn(),
}));
vi.mock('@/lib/openWeatherService', () => ({
  isWeatherApiConfigured: () => true,
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
    },
  );

  describe('weather', () => {
    const url = '/api/weather?lat=35.6&lon=139.7';

    it.each([
      [
        'SERVER_ERROR',
        createApiError(503, SECRET),
        502,
        'サーバーで問題が発生しました。サポートに連絡してください。',
        true,
      ],
      [
        'CLIENT_ERROR',
        createApiError(401, SECRET),
        401,
        'リクエストが無効です。入力内容を確認してください。',
        false,
      ],
      [
        'RATE_LIMITED',
        createApiError(429, SECRET),
        429,
        'API の使用制限に達しました。数分後にお試しください。',
        false,
      ],
      [
        'TIMEOUT',
        new ApiError(SECRET, ApiErrorType.TIMEOUT, undefined, true),
        502,
        '通信がタイムアウトしました。インターネット接続を確認して、もう一度お試しください。',
        true,
      ],
      [
        'NETWORK_ERROR',
        new ApiError(SECRET, ApiErrorType.NETWORK_ERROR, undefined, true),
        502,
        'ネットワーク接続を確認してください。',
        true,
      ],
    ])(
      '%s は種別の固定文言を返し、上流の本文はログに残す',
      async (code, thrown, status, error, retryable) => {
        vi.mocked(getCurrentWeather).mockRejectedValue(thrown);

        const response = await weather(request(url));

        expect(response.status).toBe(status);
        await expect(response.json()).resolves.toEqual({ success: false, error, code, retryable });
        expectNotInHeaders(response);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ message: SECRET }),
          'API request failed',
        );
      },
    );

    it('自前の ApiError でない例外も 500 の固定文言で返す', async () => {
      const thrown = new Error(SECRET);
      vi.mocked(getCurrentWeather).mockRejectedValue(thrown);

      const response = await weather(request(url));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: '天気データの取得中にエラーが発生しました',
        code: 'INTERNAL_ERROR',
      });
      expectNotInHeaders(response);
      expect(loggedErrors()).toContain(thrown);
    });
  });
});
