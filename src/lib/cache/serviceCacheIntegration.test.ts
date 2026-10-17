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
import { getCurrentWeather, getForecast } from '../openWeatherService';
import { getTideData } from '../tideService';
import { CACHE_TTL } from './config';

beforeEach(() => {
  vi.clearAllMocks();
  // 途中で落ちたテストの偽の時計を次のテストに持ち越さない
  vi.useRealTimers();
  cacheMock.set.mockResolvedValue(true);
});

const rawWeather = {
  coord: { lat: 35, lon: 139 },
  name: 'Tokyo',
  sys: { country: 'JP', sunrise: 1760220000, sunset: 1760260000 },
  main: { temp: 20, feels_like: 19, humidity: 60, pressure: 1013 },
  wind: { speed: 3, deg: 90 },
  clouds: { all: 10 },
  visibility: 10000,
  weather: [{ id: 800, main: 'Clear', description: '晴天', icon: '01d' }],
  dt: 1760230000,
  timezone: 32400,
};
const rawTide = {
  status: 1,
  tide: { port: { prefecture_code: 13, harbor_code: 1, harbor_namej: '東京' }, chart: {} },
};

// サービスごとに、ヘルパーへ渡すキー・TTL と上流の呼び出しを固定する。upstream は
// 上流のモックに応答を仕込み、そのモックを返す（mockResolvedValue の戻り値）。
// キーは保存済みのキャッシュとの契約なので、形が変わったら落ちてほしい。
// 座標は丸め（小数 2 桁）がキーに効くことを見るため、わざと桁を多く渡す
const services = [
  {
    name: '天気',
    call: (skipCache: boolean) => getCurrentWeather(35.6789, 139.7654, { skipCache }),
    upstream: () => apiMock.openWeatherMapClient.get.mockResolvedValue(rawWeather),
    key: 'weather:lang:ja:lat:35.68:lon:139.77:units:metric',
    ttl: CACHE_TTL.WEATHER,
  },
  {
    name: '予報',
    call: (skipCache: boolean) => getForecast(35.6789, 139.7654, { skipCache }),
    upstream: () => apiMock.openWeatherMapClient.get.mockResolvedValue({ list: [] }),
    key: 'weather:forecast:lang:ja:lat:35.68:lon:139.77:units:metric',
    ttl: CACHE_TTL.WEATHER,
  },
  {
    name: '潮汐',
    call: (skipCache: boolean) => getTideData('13', '1', '2026-10-12', { skipCache }),
    upstream: () => apiMock.tide736Client.get.mockResolvedValue(rawTide),
    key: 'tide:day:12:month:10:port:1:prefecture:13:range:week:year:2026',
    ttl: CACHE_TTL.TIDE,
  },
  {
    name: '場所検索',
    call: (skipCache: boolean) => searchLocations('東京湾', { skipCache }),
    upstream: () => geocodeMock.mockResolvedValue({ results: [] }),
    key: 'location:limit:10:query:東京湾, Japan',
    ttl: CACHE_TTL.LOCATION,
  },
];

describe.each(services)('$name のキャッシュの配線', ({ call, upstream, key, ttl }) => {
  it('キャッシュミスでは決まったキーで読み、取得した値をそのキーと TTL で書く', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'));
    cacheMock.get.mockResolvedValue(null);
    const upstreamMock = upstream();

    const result = await call(false);
    vi.useRealTimers();

    expect(result.fromCache).toBe(false);
    expect(result.fetchedAt).toBe('2026-10-12T00:00:00.000Z');
    expect(cacheMock.get).toHaveBeenCalledWith(key);
    expect(cacheMock.set).toHaveBeenCalledWith(key, result.data, ttl);
    expect(upstreamMock).toHaveBeenCalledTimes(1);
  });

  it('skipCache ではキャッシュに値があっても読まず書かず、上流を呼ぶ', async () => {
    cacheMock.get.mockResolvedValue({ stale: true });
    const upstreamMock = upstream();

    const result = await call(true);

    expect(result.fromCache).toBe(false);
    expect(cacheMock.get).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
    expect(upstreamMock).toHaveBeenCalledTimes(1);
  });
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
