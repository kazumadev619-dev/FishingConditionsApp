/**
 * 釣りやすさスコア関連の型定義
 */

/**
 * スコア要素の詳細情報
 */
export interface ScoreComponents {
  /** 潮汐スコア (0-40点) - 満潮・干潮の前後2時間のタイミング評価 */
  tide: number;
  /** 天気スコア (0-35点) - 風速、気象条件、気圧の安定性評価 */
  weather: number;
  /** 時間帯スコア (0-25点) - 日の出・日の入り前後の時間帯評価 */
  time: number;
}

/**
 * スコアランク
 */
export type ScoreRank = 'excellent' | 'good' | 'fair' | 'poor' | 'bad';

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
  bestComponent: 'tide' | 'weather' | 'time';
  /** 最も悪い要素 */
  worstComponent: 'tide' | 'weather' | 'time';
  /** 潮の種類（大潮、中潮、小潮、長潮、若潮） */
  tideName?: string;
  /** 月齢 (0-29.5)  */
  moonAge?: string;
  /** スコア計算時刻 */
  calculatedAt: Date;
}

/**
 * スコア計算API レスポンス
 */
export interface ScoringResponse {
  /** 釣りやすさスコア */
  score: FishingScore;
  /** キャッシュから取得したか */
  fromCache: boolean;
}
