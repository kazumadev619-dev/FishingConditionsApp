import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchLocations } from '@/lib/locationService';
import { getCurrentWeather } from '@/lib/openWeatherService';
import { withUserRateLimit } from '@/lib/rateLimit';
import { getTideData } from '@/lib/tideService';
import { GET as tide } from './conditions/tide/route';
import { GET as locationSearch } from './locations/search/route';
import { GET as scores } from './scores/route';
import { GET as weather } from './weather/route';

vi.mock('@/lib/cache', async (original) => ({
  ...(await original<typeof import('@/lib/cache')>()),
  withCache: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({ withUserRateLimit: vi.fn() }));
vi.mock('@/lib/locationService', () => ({
  isLocationSearchConfigured: () => true,
  searchLocations: vi.fn(async () => ({ data: [] })),
}));
vi.mock('@/lib/openWeatherService', () => ({
  isWeatherApiConfigured: () => true,
  getCurrentWeather: vi.fn(async () => ({})),
  getForecast: vi.fn(),
}));
vi.mock('@/lib/tideService', () => ({ getTideData: vi.fn(async () => ({})) }));

const request = (url: string) => new NextRequest(`https://app.test${url}`);
const passThrough = () =>
  vi
    .mocked(withUserRateLimit)
    .mockImplementation(((_name: string, handler: () => Promise<NextResponse>) =>
      handler()) as never);
const scoresUrl = '/api/scores?lat=35.6&lon=139.7&prefectureCode=13&portCode=2&date=2026-11-01';

afterEach(() => vi.clearAllMocks());

describe('上流を呼ぶルート', () => {
  it.each([
    ['locations-search', locationSearch, '/api/locations/search?q=tokyo'],
    ['weather', weather, '/api/weather?lat=35.6&lon=139.7'],
    ['tide', tide, '/api/conditions/tide?prefectureCode=13&portCode=2'],
    ['scores', scores, scoresUrl],
  ] as const)('%s は上限を超えると上流を呼ばない', async (name, GET, url) => {
    vi.mocked(withUserRateLimit).mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 }) as never,
    );

    const response = await GET(request(url));

    expect(response.status).toBe(429);
    expect(withUserRateLimit).toHaveBeenCalledWith(name, expect.any(Function));
    expect(getCurrentWeather).not.toHaveBeenCalled();
    expect(getTideData).not.toHaveBeenCalled();
    expect(searchLocations).not.toHaveBeenCalled();
  });

  it('skipCache の指定は上流へ渡らない', async () => {
    passThrough();

    await locationSearch(request('/api/locations/search?q=tokyo&skipCache=true'));
    await weather(request('/api/weather?lat=35.6&lon=139.7&skipCache=true'));
    await tide(request('/api/conditions/tide?prefectureCode=13&portCode=2&skipCache=true'));

    expect(vi.mocked(searchLocations).mock.calls[0][1]).not.toHaveProperty('skipCache');
    expect(vi.mocked(getCurrentWeather).mock.calls[0][2]).not.toHaveProperty('skipCache');
    expect(vi.mocked(getTideData).mock.calls[0][3]).not.toHaveProperty('skipCache');
  });

  it('weather の lang の指定はキャッシュキーを変えない', async () => {
    passThrough();

    await weather(request('/api/weather?lat=35.6&lon=139.7&lang=zz'));

    expect(vi.mocked(getCurrentWeather).mock.calls[0][2]).not.toHaveProperty('lang');
  });
});
