import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const apiMock = vi.hoisted(() => ({
  openWeatherMapClient: { get: vi.fn() },
  tide736Client: { get: vi.fn() },
}));
const geocodeMock = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({ cache: cacheMock }));
vi.mock('../apiClient', () => apiMock);
vi.mock('../googleMapsClient', () => ({ geocode: geocodeMock }));

import { searchLocations } from '../locationService';
import { getCurrentWeather } from '../openWeatherService';
import { getTideData } from '../tideService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('キャッシュを使うサービス', () => {
  it('天気のキャッシュヒットで Date フィールドを復元する', async () => {
    cacheMock.get.mockResolvedValue({
      sunrise: '2026-10-12T00:00:00.000Z',
      sunset: '2026-10-12T09:00:00.000Z',
      dataTime: '2026-10-12T01:00:00.000Z',
    });

    const result = await getCurrentWeather(35, 139);

    expect(result.fromCache).toBe(true);
    expect(result.data.sunrise).toBeInstanceOf(Date);
    expect(result.data.sunset).toBeInstanceOf(Date);
    expect(result.data.dataTime).toBeInstanceOf(Date);
    expect(apiMock.openWeatherMapClient.get).not.toHaveBeenCalled();
  });

  it('潮汐のキャッシュヒットで Date フィールドを復元する', async () => {
    cacheMock.get.mockResolvedValue({
      port: { prefecture_code: '13', port_code: '1', port_name: '東京' },
      tides: [],
      dataTime: '2026-10-12T01:00:00.000Z',
    });

    const result = await getTideData('13', '1', '2026-10-12');

    expect(result.fromCache).toBe(true);
    expect(result.data.dataTime).toBeInstanceOf(Date);
    expect(apiMock.tide736Client.get).not.toHaveBeenCalled();
  });

  it('場所検索の skipCache 時も元の query をレスポンスに保持する', async () => {
    geocodeMock.mockResolvedValue({ results: [] });

    const result = await searchLocations('東京湾', { skipCache: true });

    expect(result).toMatchObject({ data: [], fromCache: false, query: '東京湾' });
    expect(cacheMock.get).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
    expect(geocodeMock).toHaveBeenCalledWith('東京湾, Japan');
  });
});
