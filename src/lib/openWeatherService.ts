/**
 * OpenWeatherMap APIサービス
 * 天気情報の取得とキャッシング機能を提供
 */

import type { CurrentWeatherData, ForecastData } from '@/types/weather';
import { openWeatherMapClient } from './apiClient';
import { CACHE_PREFIX, CACHE_TTL, generateCacheKey, withCache } from './cache';

/**
 * 天気取得時のオプション
 */
export interface WeatherOptions {
  /** 言語コード（デフォルト: ja） */
  lang?: string;
  /** 単位系（デフォルト: metric） */
  units?: 'standard' | 'metric' | 'imperial';
  /** キャッシュをスキップするか */
  skipCache?: boolean;
}

/**
 * 天気サービスのレスポンス型
 */
export interface WeatherResponse<T> {
  data: T;
  fromCache: boolean;
  fetchedAt: string;
}

/**
 * アプリケーション用に整形された天気データ
 */
export interface FormattedWeatherData {
  /** 座標 */
  coordinates: {
    lat: number;
    lon: number;
  };
  /** 都市名 */
  cityName: string;
  /** 国コード */
  country: string;
  /** 気温（摂氏） */
  temperature: number;
  /** 体感気温 */
  feelsLike: number;
  /** 最低気温 */
  tempMin: number;
  /** 最高気温 */
  tempMax: number;
  /** 湿度（%） */
  humidity: number;
  /** 気圧（hPa） */
  pressure: number;
  /** 風速（m/s） */
  windSpeed: number;
  /** 風向（度） */
  windDeg: number;
  /** 突風（m/s） */
  windGust?: number;
  /** 雲量（%） */
  cloudiness: number;
  /** 視程（m） */
  visibility: number;
  /** 天気状態 */
  weather: {
    id: number;
    main: string;
    description: string;
    icon: string;
  };
  /** 雨量（mm/h） */
  rain?: number;
  /** 雪量（mm/h） */
  snow?: number;
  /** 日の出時刻 */
  sunrise: Date;
  /** 日の入り時刻 */
  sunset: Date;
  /** データ取得時刻 */
  dataTime: Date;
  /** タイムゾーンオフセット（秒） */
  timezone: number;
}

/**
 * 座標を小数点2桁に丸める（キャッシュ効率化）
 */
function roundCoordinates(lat: number, lon: number): { roundedLat: number; roundedLon: number } {
  return {
    roundedLat: Math.round(lat * 100) / 100,
    roundedLon: Math.round(lon * 100) / 100,
  };
}

/**
 * skipCache オプションを考慮してキャッシュ経由でデータ取得し、WeatherResponse 形式で返す
 */
async function fetchWithOptionalCache<T>(
  cacheKey: string,
  ttl: number,
  skipCache: boolean,
  fetcher: () => Promise<T>,
  revive?: (cached: T) => T,
): Promise<WeatherResponse<T>> {
  if (skipCache) {
    const data = await fetcher();
    return { data, fromCache: false, fetchedAt: new Date().toISOString() };
  }

  const { data, fromCache } = await withCache(cacheKey, ttl, fetcher, revive);
  return { data, fromCache, fetchedAt: new Date().toISOString() };
}

/**
 * OpenWeatherMap APIからのレスポンスをアプリ用に整形
 */
function formatWeatherData(raw: CurrentWeatherData): FormattedWeatherData {
  return {
    coordinates: {
      lat: raw.coord.lat,
      lon: raw.coord.lon,
    },
    cityName: raw.name,
    country: raw.sys.country,
    temperature: raw.main.temp,
    feelsLike: raw.main.feels_like,
    tempMin: raw.main.temp_min ?? raw.main.temp,
    tempMax: raw.main.temp_max ?? raw.main.temp,
    humidity: raw.main.humidity,
    pressure: raw.main.pressure,
    windSpeed: raw.wind.speed,
    windDeg: raw.wind.deg,
    windGust: raw.wind.gust,
    cloudiness: raw.clouds.all,
    visibility: raw.visibility,
    weather: {
      id: raw.weather[0].id,
      main: raw.weather[0].main,
      description: raw.weather[0].description,
      icon: raw.weather[0].icon,
    },
    rain: raw.rain?.['1h'],
    snow: raw.snow?.['1h'],
    sunrise: new Date(raw.sys.sunrise * 1000),
    sunset: new Date(raw.sys.sunset * 1000),
    dataTime: new Date(raw.dt * 1000),
    timezone: raw.timezone,
  };
}

/**
 * キャッシュヒット時に Date フィールドを Date インスタンスへ復元する（withCache の revive）。
 *
 * キャッシュは JSON で往復するため、Date は ISO 文字列に落ちて戻ってこない。
 * FormattedWeatherData は sunrise / sunset / dataTime を Date と宣言しているので、
 * この契約を守らないと呼び出し側（scoring/timeScore.ts の getHours() など）が
 * 実行時に壊れる。
 */
function reviveWeatherDates(data: FormattedWeatherData): FormattedWeatherData {
  return {
    ...data,
    sunrise: new Date(data.sunrise),
    sunset: new Date(data.sunset),
    dataTime: new Date(data.dataTime),
  };
}

/**
 * 座標から現在の天気を取得
 * @param lat 緯度
 * @param lon 経度
 * @param options オプション
 */
export async function getCurrentWeather(
  lat: number,
  lon: number,
  options: WeatherOptions = {},
): Promise<WeatherResponse<FormattedWeatherData>> {
  const { lang = 'ja', units = 'metric', skipCache = false } = options;

  const { roundedLat, roundedLon } = roundCoordinates(lat, lon);

  const cacheKey = generateCacheKey(CACHE_PREFIX.WEATHER, {
    lat: roundedLat,
    lon: roundedLon,
    lang,
    units,
  });

  const fetcher = async (): Promise<FormattedWeatherData> => {
    const rawData = await openWeatherMapClient.get<CurrentWeatherData>('/weather', {
      params: {
        lat: String(lat),
        lon: String(lon),
        lang,
        units,
      },
    });
    return formatWeatherData(rawData);
  };

  return fetchWithOptionalCache(
    cacheKey,
    CACHE_TTL.WEATHER,
    skipCache,
    fetcher,
    reviveWeatherDates,
  );
}

/**
 * 座標から5日間の天気予報を取得
 * @param lat 緯度
 * @param lon 経度
 * @param options オプション
 */
export async function getForecast(
  lat: number,
  lon: number,
  options: WeatherOptions = {},
): Promise<WeatherResponse<ForecastData>> {
  const { lang = 'ja', units = 'metric', skipCache = false } = options;

  const { roundedLat, roundedLon } = roundCoordinates(lat, lon);

  const cacheKey = generateCacheKey(`${CACHE_PREFIX.WEATHER}:forecast`, {
    lat: roundedLat,
    lon: roundedLon,
    lang,
    units,
  });

  const fetcher = (): Promise<ForecastData> =>
    openWeatherMapClient.get<ForecastData>('/forecast', {
      params: {
        lat: String(lat),
        lon: String(lon),
        lang,
        units,
      },
    });

  return fetchWithOptionalCache(cacheKey, CACHE_TTL.WEATHER, skipCache, fetcher);
}

/**
 * APIキーが設定されているかチェック
 */
export function isWeatherApiConfigured(): boolean {
  return Boolean(process.env.OPENWEATHERMAP_API_KEY);
}
