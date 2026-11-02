import { inspect } from 'node:util';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiError } from '@/lib/api/errorHandler';
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

afterEach(() => vi.clearAllMocks());

describe('失敗の応答に例外の message を入れない（#313）', () => {
  it.each([
    ['ports', () => vi.mocked(prisma.ports.findMany), () => ports(request('/api/ports'))],
    ['favorites GET', () => vi.mocked(prisma.user_favorites.findMany), () => getFavorites()],
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
    ],
    [
      'favorites DELETE',
      () => vi.mocked(prisma.user_favorites.deleteMany),
      () => deleteFavorite(request(`/api/favorites?locationId=${userId}`, { method: 'DELETE' })),
    ],
    ['scores', () => vi.mocked(getCurrentWeather), () => scores(request(scoresUrl))],
    [
      'locations/search',
      () => vi.mocked(searchLocations),
      () => locationSearch(request('/api/locations/search?q=tokyo')),
    ],
    [
      'conditions/tide',
      () => vi.mocked(getTideData),
      () => tide(request('/api/conditions/tide?prefectureCode=13&portCode=2')),
    ],
  ] as const)('%s の 500 は固定の文言を返し、詳細はログに残す', async (_name, dependency, call) => {
    dependency().mockRejectedValue(new Error(SECRET) as never);

    const response = await call();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body).error).toEqual(expect.any(String));
    expect(body).not.toContain(SECRET);
    expect(inspect(vi.mocked(logger.error).mock.calls)).toContain(SECRET);
  });

  describe('weather', () => {
    const url = '/api/weather?lat=35.6&lon=139.7';

    it.each([
      [503, 502],
      [401, 401],
    ])('上流の %i の本文は返さず、%i の応答の詳細はログに残す', async (upstream, status) => {
      vi.mocked(getCurrentWeather).mockRejectedValue(createApiError(upstream, SECRET));

      const response = await weather(request(url));
      const body = await response.text();

      expect(response.status).toBe(status);
      expect(JSON.parse(body)).toMatchObject({ success: false, error: expect.any(String) });
      expect(body).not.toContain(SECRET);
      expect(inspect(vi.mocked(logger.error).mock.calls)).toContain(SECRET);
    });

    it('自前の ApiError でない例外も 500 の固定文言で返す', async () => {
      vi.mocked(getCurrentWeather).mockRejectedValue(new Error(SECRET));

      const response = await weather(request(url));
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).not.toContain(SECRET);
      expect(inspect(vi.mocked(logger.error).mock.calls)).toContain(SECRET);
    });
  });
});
