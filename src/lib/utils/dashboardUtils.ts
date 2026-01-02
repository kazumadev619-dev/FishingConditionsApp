/**
 * ダッシュボード用ユーティリティ関数
 */

import type { ScoreRank } from '@/types/scoring';

/**
 * スコアからランクを取得
 */
export function getScoreRank(score: number): ScoreRank {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'bad';
}

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

/**
 * 日付をフォーマット
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}

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

export function formatTideEvent(timeStr: string, cmStr: string): TideEventDisplay {
  const [hours, minutes] = timeStr.split(':');
  const timeDate = new Date();
  timeDate.setHours(parseInt(hours, 10), parseInt(minutes, 10));

  return {
    time: formatTime(timeDate),
    height: `${(parseInt(cmStr) / 100).toFixed(1)}m`,
  };
}
