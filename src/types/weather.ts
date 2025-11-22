/**
 * OpenWeatherMap APIから返される現在の気象データ
 * @see https://openweathermap.org/current
 */
export interface CurrentWeatherData {
  /** 座標 */
  coord: {
    /** 経度 */
    lon: number;
    /** 緯度 */
    lat: number;
  };
  /** 天気状態のリスト */
  weather: WeatherCondition[];
  /** 内部パラメータ */
  base: string;
  /** 主要な気象情報 */
  main: MainWeather;
  /** 視程 (メートル) */
  visibility: number;
  /** 風の情報 */
  wind: Wind;
  /** 雲量 */
  clouds: {
    /** 雲の割合 (%) */
    all: number;
  };
  /** 雨量 (任意) */
  rain?: {
    /** 直近1時間の雨量 (mm) */
    '1h'?: number;
    /** 直近3時間の雨量 (mm) */
    '3h'?: number;
  };
  /** 雪量 (任意) */
  snow?: {
    /** 直近1時間の雪量 (mm) */
    '1h'?: number;
    /** 直近3時間の雪量 (mm) */
    '3h'?: number;
  };
  /** データ計算時刻 (Unix, UTC) */
  dt: number;
  /** システム情報 */
  sys: {
    type: number;
    id: number;
    /** 国コード (JP, USなど) */
    country: string;
    /** 日の出時刻 (Unix, UTC) */
    sunrise: number;
    /** 日の入り時刻 (Unix, UTC) */
    sunset: number;
  };
  /** タイムゾーン (UTCからの秒単位のシフト) */
  timezone: number;
  /** 都市ID */
  id: number;
  /** 都市名 */
  name: string;
  /** 内部パラメータ */
  cod: number;
}

/**
 * OpenWeatherMap APIから返される5日間/3時間ごとの天気予報データ
 * @see https://openweathermap.org/forecast5
 */
export interface ForecastData {
  /** レスポンスコード */
  cod: string;
  /** 内部パラメータ */
  message: number;
  /** 返されるタイムスタンプの数 */
  cnt: number;
  /** 3時間ごとの予報データリスト */
  list: ForecastItem[];
  /** 都市情報 */
  city: {
    id: number;
    name: string;
    coord: {
      lat: number;
      lon: number;
    };
    country: string;
    population: number;
    timezone: number;
    sunrise: number;
    sunset: number;
  };
}

/**
 * 3時間ごとの予報データの各アイテム
 */
export interface ForecastItem {
  /** データ計算時刻 (Unix, UTC) */
  dt: number;
  /** 主要な気象情報 */
  main: MainWeather & {
    /** 最低気温 */
    temp_min: number;
    /** 最高気温 */
    temp_max: number;
    /** 海面気圧 */
    sea_level: number;
    /** 地上気圧 */
    grnd_level: number;
    /** 内部パラメータ */
    temp_kf: number;
  };
  /** 天気状態のリスト */
  weather: WeatherCondition[];
  /** 雲量 */
  clouds: {
    all: number;
  };
  /** 風の情報 */
  wind: Wind;
  /** 視程 (メートル) */
  visibility: number;
  /** 降水確率 (0-1) */
  pop: number;
  /** システム情報 */
  sys: {
    /** 昼夜区分 ('d' or 'n') */
    pod: 'd' | 'n';
  };
  /** データ計算時刻の文字列 (UTC) */
  dt_txt: string;
  /** 雨量 (任意) */
  rain?: {
    '3h'?: number;
  };
  /** 雪量 (任意) */
  snow?: {
    '3h'?: number;
  };
}

/**
 * 天気状態に関する共通インターフェース
 */
export interface WeatherCondition {
  /** 天気状態ID */
  id: number;
  /** 天気パラメータのグループ (Rain, Snow, Extremeなど) */
  main: string;
  /** グループ内の天気状態の詳細な説明 */
  description: string;
  /** 天気アイコンID */
  icon: string;
}

/**
 * 主要な気象情報に関する共通インターフェース
 */
export interface MainWeather {
  /** 気温 (単位: `units`パラメータに依存) */
  temp: number;
  /** 体感気温 */
  feels_like: number;
  /** 気圧 (hPa) */
  pressure: number;
  /** 湿度 (%) */
  humidity: number;
  /** 最低気温 (現在の気象データでは任意) */
  temp_min?: number;
  /** 最高気温 (現在の気象データでは任意) */
  temp_max?: number;
}

/**
 * 風に関する共通インターフェース
 */
export interface Wind {
  /** 風速 (単位: `units`パラメータに依存) */
  speed: number;
  /** 風向 (度) */
  deg: number;
  /** 突風 (任意) */
  gust?: number;
}
