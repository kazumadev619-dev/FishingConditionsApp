/**
 * 釣りやすさスコア関連の型定義
 */

/**
 * スコア要素の詳細情報
 */
export interface ScoreComponents {
  /** 潮汐スコア (0-65点) - 満潮・干潮の前後2時間のタイミング評価 */
  tide: number;
  /** 天気スコア (0-35点) - 風速、気象条件、気圧の安定性評価 */
  weather: number;
}

/**
 * スコアランク
 */
export type ScoreRank = 'excellent' | 'good' | 'fair' | 'poor' | 'bad';

/**
 * スコアランク情報
 */
export interface RankInfo {
  rank: ScoreRank;
  label: string;
  color: string;
  description: string;
}

/**
 * 釣りやすさスコア全体
 */
export interface FishingScore {
  /** 総合スコア (0-100) */
  score: number;
  /** スコアランク */
  rank: ScoreRank;
  /** 各要素のスコア */
  components: ScoreComponents;
  /** スコアに関する説明 */
  explanation: string;
  /** 最も良い要素 */
  bestComponent: 'tide' | 'weather';
  /** 最も悪い要素 */
  worstComponent: 'tide' | 'weather';
  /** スコア計算時刻 */
  calculatedAt: Date;
}

/**
 * 潮汐スコアの詳細情報
 */
export interface TideScoreBreakdown {
  /** 潮汐タイミングスコア (0-25点) */
  timing: number;
  /** 潮の大きさスコア (0-15点) */
  size: number;
  /** 最も近い満潮・干潮までの時間（分） */
  minutesToNextExtreme: number;
  /** 潮位差（メートル） */
  tideRange: number;
  /** 潮の大きさレベル ('large' | 'medium' | 'small' | 'very_small') */
  tideSizeLevel: 'large' | 'medium' | 'small' | 'very_small';
}

/**
 * 天気スコアの詳細情報
 */
export interface WeatherScoreBreakdown {
  /** 風速スコア (0-15点) */
  windSpeed: number;
  /** 気象条件スコア (0-12点) */
  condition: number;
  /** 気圧安定性スコア (0-8点) */
  pressureStability: number;
  /** 実測風速 (m/s) */
  actualWindSpeed: number;
  /** 気象メイン条件 */
  weatherMain: string;
  /** 気圧変化 (hPa) */
  pressureChange: number;
}

/**
 * スコア計算のオプション
 */
export interface ScoringOptions {
  /** 地点ID */
  locationId?: string;
  /** キャッシュをスキップするか */
  skipCache?: boolean;
  /** 詳細情報を含めるか */
  includeBreakdown?: boolean;
}

/**
 * スコア計算API レスポンス
 */
export interface ScoringResponse {
  /** 釣りやすさスコア */
  score: FishingScore;
  /** キャッシュから取得したか */
  fromCache: boolean;
  /** 詳細な要素ごとの情報（オプション） */
  breakdown?: {
    tide: TideScoreBreakdown;
    weather: WeatherScoreBreakdown;
  };
}
