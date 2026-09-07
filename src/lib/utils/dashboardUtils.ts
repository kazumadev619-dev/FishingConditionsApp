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
 * 時刻をフォーマット (HH:mm)
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
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
  const [hours, minutes] = timeStr.split(':');
  const timeDate = new Date();
  timeDate.setHours(parseInt(hours, 10), parseInt(minutes, 10));

  return {
    time: formatTime(timeDate),
    height: `${(cm / 100).toFixed(1)}m`,
  };
}
