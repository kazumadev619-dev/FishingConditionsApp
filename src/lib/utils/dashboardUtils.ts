/**
 * ダッシュボード用ユーティリティ関数
 */

import type { ScoreRank } from '@/types/scoring';

export { getScoreRank } from './scoreRank';

/**
 * ランクから色を取得
 */
export function getRankColor(rank: ScoreRank): string {
  const colors = {
    excellent: '#22c55e', // 緑
    good: '#3b82f6', // 青
    fair: '#f59e0b', // オレンジ
    poor: '#f97316', // オレンジ赤
    bad: '#ef4444', // 赤
  };
  return colors[rank];
}

/**
 * ランクからラベルを取得
 */
export function getRankLabel(rank: ScoreRank): string {
  const labels = {
    excellent: '絶好調',
    good: '良好',
    fair: '普通',
    poor: 'やや不利',
    bad: '不適',
  };
  return labels[rank];
}

/**
 * 表示に使うタイムゾーン。釣り場も潮汐データ（HH:mm）も日本の時刻なので固定する。
 *
 * 省くと実行環境のタイムゾーンで整形され、サーバー（コンテナは UTC）が描画した
 * HTML とブラウザ（JST）の最初の描画で文字列が食い違い、hydration エラー #418 になる（#234）
 */
const DISPLAY_TIME_ZONE = 'Asia/Tokyo';

/**
 * 時刻をフォーマット (HH:mm)
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DISPLAY_TIME_ZONE,
  });
}

/**
 * 日時をフォーマット (YYYY/M/D H:mm:ss)
 */
export function formatDateTime(date: Date): string {
  return date.toLocaleString('ja-JP', { timeZone: DISPLAY_TIME_ZONE });
}

export { formatDisplayDate as formatDate } from './dateUtils';

/**
 * 風向を日本語に変換
 */
export function getWindDirection(deg: number): string {
  const directions = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const index = Math.round((deg % 360) / 45) % 8;
  return directions[index];
}

/**
 * 時間帯カテゴリを取得
 */
export function getTimeCategory(score: number): string {
  if (score >= 20) return 'ゴールデンタイム';
  if (score >= 10) return '良好な時間帯';
  return '通常の時間帯';
}

/**
 * 時間帯の説明文を取得
 */
export function getTimeExplanation(score: number): string {
  if (score >= 20) return '日の出・日の入り前後は魚の活性が高まります';
  if (score >= 10) return '比較的良好な釣り時間帯です';
  return '通常の時間帯ですが、条件次第で釣果が期待できます';
}

/**
 * 潮汐イベント（満潮・干潮）をフォーマット
 */
export interface TideEventDisplay {
  time: string;
  height: string;
}

export function formatTideEvent(timeStr: string, cm: number): TideEventDisplay {
  // timeStr は既に日本時刻の HH:mm。Date を経由すると実行環境のタイムゾーンで解釈されるので、文字列のまま揃える
  const [hours, minutes] = timeStr.split(':');

  return {
    time: `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`,
    height: `${(cm / 100).toFixed(1)}m`,
  };
}
