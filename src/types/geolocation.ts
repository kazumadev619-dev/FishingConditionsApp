/**
 * OpenWeatherMap APIから返されるジオコーディング結果の配列
 * @see https://openweathermap.org/api/geocoding-api
 */
export type GeocodingApiResponse = GeocodingResult[];

/**
 * ジオコーディング結果の各アイテム
 */
export interface GeocodingResult {
  /** 地名 */
  name: string;
  /** 各言語での地名 (任意) */
  local_names?: {
    [key: string]: string;
  };
  /** 緯度 */
  lat: number;
  /** 経度 */
  lon: number;
  /** 国コード (JP, USなど) */
  country: string;
  /** 州/都道府県名 (任意) */
  state?: string;
}
