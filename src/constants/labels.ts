/**
 * UI表示用の定数・ラベル
 */

/**
 * ダッシュボード関連のラベル
 */
export const DASHBOARD_LABELS = {
  LOCATION_SUFFIX: 'の釣り条件',
  LAST_UPDATED: '最終更新:',
  SCORE_EXPLANATION_TITLE: '📊 スコアの説明',
  LOCATION_MAP_TITLE: '📍 釣り場の位置',
} as const;

/**
 * スコアカード関連のラベル
 */
export const SCORE_CARD_LABELS = {
  TITLE: '釣りやすさスコア',
  TIDE: '🌊 潮汐:',
  WEATHER: '☀️ 天気:',
  TIME: '🕐 時間:',
  DETAILS_BUTTON: '詳細を見る',
  TIDE_MAX: '/40',
  WEATHER_MAX: '/35',
  TIME_MAX: '/25',
} as const;

/**
 * 天気カード関連のラベル
 */
export const WEATHER_CARD_LABELS = {
  TITLE: '☀️ 天気情報',
  SCORE: '天気スコア:',
  WIND_SPEED: '💨 風速:',
  WIND_DIRECTION: '🧭 風向:',
  HUMIDITY: '💧 湿度:',
  PRESSURE: '🌡️ 気圧:',
  CLOUDINESS: '☁️ 雲量:',
  VISIBILITY: '👁️ 視程:',
  SUNRISE: '🌅 日の出:',
  SUNSET: '🌇 日の入り:',
  WIND_SPEED_UNIT: 'm/s',
  HUMIDITY_UNIT: '%',
  PRESSURE_UNIT: 'hPa',
  CLOUDINESS_UNIT: '%',
  VISIBILITY_UNIT: 'km',
  TEMPERATURE_UNIT: '°C',
} as const;

/**
 * 潮汐カード関連のラベル
 */
export const TIDE_CARD_LABELS = {
  TITLE: '🌊 潮汐情報',
  SCORE: '潮汐スコア:',
  HIGH_TIDE: '満潮',
  LOW_TIDE: '干潮',
  TIDE_TYPE: '潮の種類:',
  MOON_AGE: '月齢:',
  MOON_AGE_UNIT: '日',
} as const;

/**
 * 時間帯カード関連のラベル
 */
export const TIME_CARD_LABELS = {
  TITLE: '🕐 時間帯スコア',
  CURRENT_TIME: '⏰ 現在時刻:',
  SUNRISE: '🌅 日の出:',
  SUNSET: '🌇 日の入り:',
  CATEGORY_PREFIX: '✨',
} as const;
