import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ openWeatherMapClient: { get: vi.fn() } }));
const cacheMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./cache/client', () => ({ cache: cacheMock }));
vi.mock('./apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./apiClient')>()),
  ...apiMock,
}));

import { ApiError, ApiErrorType } from './apiClient';
import { getCurrentWeather } from './openWeatherService';

const rawWeather = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const withPressure = (pressure: unknown) => ({
  main: { temp: 20, feels_like: 19, humidity: 60, pressure },
});

const fetchWeather = () => getCurrentWeather(35, 139, { skipCache: true });

beforeEach(() => vi.clearAllMocks());

// #414: 風速が有限の数値でない応答は、不正な応答として弾く（OpenWeather の応答を受け取る時点）。
// 通すと、風の点は 0 点なのに説明文の風の注意が出ない食い違いになる。
describe('風速が有限の数値でない応答は弾く（#414）', () => {
  it.each([
    ['speed が無い', { wind: { deg: 90 } }],
    ['speed が null', { wind: { speed: null, deg: 90 } }],
    ['speed が NaN', { wind: { speed: Number.NaN, deg: 90 } }],
    ['speed が文字列', { wind: { speed: '5', deg: 90 } }],
    ['speed が Infinity', { wind: { speed: Number.POSITIVE_INFINITY, deg: 90 } }],
    ['wind 自体が無い', { wind: undefined }],
  ])('%s → 502 の ApiError（SERVER_ERROR）', async (_label, overrides) => {
    apiMock.openWeatherMapClient.get.mockResolvedValue(rawWeather(overrides));

    const error = await fetchWeather().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 502, type: ApiErrorType.SERVER_ERROR });
  });

  it.each([0, 0.5, 6, 25])('風速 %s は通す（0 は欠損ではない）', async (speed) => {
    apiMock.openWeatherMapClient.get.mockResolvedValue(rawWeather({ wind: { speed, deg: 90 } }));

    const result = await fetchWeather();

    expect(result.data.windSpeed).toBe(speed);
  });

  it('弾いた応答は、キャッシュに書かない', async () => {
    apiMock.openWeatherMapClient.get.mockResolvedValue(rawWeather({ wind: { deg: 90 } }));

    cacheMock.get.mockResolvedValue({ hit: false });

    await expect(getCurrentWeather(35, 139)).rejects.toBeInstanceOf(ApiError);

    expect(cacheMock.set).not.toHaveBeenCalled();
  });
});

// 気圧が数値でないと、気圧の点の「<990 || >1030」が false になり、満点（8点）になる。
describe('気圧が有限の数値でない応答は弾く（#414）', () => {
  it.each([
    ['pressure が無い', { main: { temp: 20, feels_like: 19, humidity: 60 } }],
    ['pressure が null', withPressure(null)],
    ['pressure が NaN', withPressure(Number.NaN)],
    ['pressure が文字列', withPressure('1013')],
    ['pressure が無限大', withPressure(Number.NEGATIVE_INFINITY)],
    ['main 自体が無い', { main: undefined }],
  ])('%s → 502 の ApiError（SERVER_ERROR）', async (_label, overrides) => {
    apiMock.openWeatherMapClient.get.mockResolvedValue(rawWeather(overrides));

    const error = await fetchWeather().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 502, type: ApiErrorType.SERVER_ERROR });
  });

  it.each([0, 985, 1013, 1040])('気圧 %s は通す', async (pressure) => {
    apiMock.openWeatherMapClient.get.mockResolvedValue(rawWeather(withPressure(pressure)));

    const result = await fetchWeather();

    expect(result.data.pressure).toBe(pressure);
  });
});
