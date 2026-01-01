/**
 * ダッシュボード関連の型定義
 */

import type { FishingScore } from './scoring';
import type { FormattedWeatherData } from '@/lib/openWeatherService';
import type { FormattedTideData, DailyTide } from '@/lib/tideService';

/**
 * 時間帯スコア情報
 */
export interface TimeScoreInfo {
  /** 時間帯スコア (0-25) */
  score: number;
  /** 現在時刻 */
  currentTime: Date;
  /** 日の出時刻 */
  sunrise: Date;
  /** 日の入り時刻 */
  sunset: Date;
  /** 時間帯カテゴリ */
  timeCategory: string;
  /** 説明文 */
  explanation: string;
}

/**
 * ダッシュボードデータ
 */
export interface DashboardData {
  /** 場所情報 */
  location: {
    name: string;
    latitude: number;
    longitude: number;
  };
  /** 釣りスコア */
  fishingScore: FishingScore;
  /** 潮汐データ */
  tideData: FormattedTideData;
  /** 本日の潮汐情報 */
  todayTide: DailyTide;
  /** 天気データ */
  weatherData: FormattedWeatherData;
  /** 時間帯スコア情報 */
  timeScore: TimeScoreInfo;
}
