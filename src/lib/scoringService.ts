/**
 * 釣りやすさスコア算出エンジン
 * 潮汐、天気、時間帯から総合スコアを計算
 */

import type { FormattedWeatherData } from './openWeatherService';
import type { FormattedTideData } from './tideService';
import type { FishingScore, ScoreRank } from '@/types/scoring';

class ScoringEngine {
  /**
   * 総合スコアを計算
   */
  public calculateFishingScore(
    tideData: FormattedTideData,
    weatherData: FormattedWeatherData,
    currentTime: Date = new Date(),
  ): FishingScore {
    // 各要素のスコアを計算
    const tideScore = this.calculateTideScore(tideData, currentTime);
    const weatherScore = this.calculateWeatherScore(weatherData);

    // 総合スコア = 潮汐(65) + 天気(35)
    // ※ 時間帯は潮汐タイミングスコアに完全に統合されているため、独立した評価は不要
    const totalScore = tideScore + weatherScore;

    // スコアをクリップ (0-100)
    const clippedScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    // ランクを判定
    const rank = this.getRankFromScore(clippedScore);

    // 最良・最悪要素を判定
    const components = {
      tide: tideScore,
      weather: weatherScore,
    };

    const bestComponent = Object.entries(components).reduce((a, b) => (b[1] > a[1] ? b : a))[0] as
      | 'tide'
      | 'weather';

    const worstComponent = Object.entries(components).reduce((a, b) => (b[1] < a[1] ? b : a))[0] as
      | 'tide'
      | 'weather';

    // 説明文を生成
    const explanation = this.generateExplanation(clippedScore, bestComponent, weatherData);

    return {
      score: clippedScore,
      rank,
      components,
      explanation,
      bestComponent,
      worstComponent,
      calculatedAt: currentTime,
    };
  }

  /**
   * 潮汐スコアを計算 (0-40点)
   */
  private calculateTideScore(tideData: FormattedTideData, currentTime: Date): number {
    // 本日の潮汐データを取得
    const today = this.formatDateToString(currentTime);
    const todayTides = tideData.tides.find((t) => t.date === today);

    if (!todayTides) {
      // データがない場合はニュートラルスコア
      return 32.5; // 中間値
    }

    const dailyTide = todayTides.daily;
    const currentHour = currentTime.getHours();
    const currentMinutes = currentTime.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinutes;

    // 満潮・干潮の時刻を分単位で計算
    const allExtremes = [
      ...dailyTide.flood.map((f) => ({
        time: f.time,
        type: 'flood' as const,
        height: parseInt(f.cm),
      })),
      ...dailyTide.edd.map((e) => ({
        time: e.time,
        type: 'edd' as const,
        height: parseInt(e.cm),
      })),
    ].map((e) => {
      const [hours, minutes] = e.time.split(':').map(Number);
      return {
        ...e,
        totalMinutes: hours * 60 + minutes,
      };
    });

    // 満潮・干潮が存在するかチェック
    const floods = allExtremes.filter((e) => e.type === 'flood');
    const edds = allExtremes.filter((e) => e.type === 'edd');

    if (floods.length === 0 || edds.length === 0) {
      // 潮汐データが不完全な場合はニュートラルスコア
      return 32.5; // 中間値
    }

    // 現在時刻に最も近い極値までの時間を計算
    let minDiff = Infinity;
    for (const extreme of allExtremes) {
      const diff = Math.abs(extreme.totalMinutes - currentTotalMinutes);
      minDiff = Math.min(minDiff, diff);
    }

    // 潮汐タイミングスコア (0-40点)
    // 満潮・干潮の前後2時間が釣りの最適時間帯
    let timingScore = 0;
    const minutesInHour = 60;
    const hoursFromExtreme = minDiff / minutesInHour;

    if (hoursFromExtreme <= 2) {
      // 前後2時間以内: 高スコア
      timingScore = 40 - hoursFromExtreme * 10; // 2時間で40点から20点に減少
    } else if (hoursFromExtreme <= 4) {
      // 前後4時間以内: 中スコア
      timingScore = 20 - (hoursFromExtreme - 2) * 10; // 4時間で20点から0点に減少
    } else {
      timingScore = 0;
    }

    // 潮の大きさスコア (0-25点)
    // 現在時刻に最も近い満潮と干潮を見つける
    const nearestFlood = floods.reduce((closest, current) => {
      const currentDiff = Math.abs(current.totalMinutes - currentTotalMinutes);
      const closestDiff = Math.abs(closest.totalMinutes - currentTotalMinutes);
      return currentDiff < closestDiff ? current : closest;
    });

    const nearestEdd = edds.reduce((closest, current) => {
      const currentDiff = Math.abs(current.totalMinutes - currentTotalMinutes);
      const closestDiff = Math.abs(closest.totalMinutes - currentTotalMinutes);
      return currentDiff < closestDiff ? current : closest;
    });

    // 最も近い満潮・干潮の潮位差を計算
    const tideRange = (nearestFlood.height - nearestEdd.height) / 100; // cm から m に変換

    let sizeScore = 0;
    if (tideRange >= 1.5)
      sizeScore = 25; // 大潮
    else if (tideRange >= 1.0)
      sizeScore = 20; // 中潮
    else if (tideRange >= 0.5)
      sizeScore = 13; // 小潮
    else sizeScore = 8; // 長潮・若潮

    return Math.min(65, timingScore + sizeScore);
  }

  /**
   * 天気スコアを計算 (0-35点)
   */
  private calculateWeatherScore(weatherData: FormattedWeatherData): number {
    // 風速スコア (0-15点)
    let windScore = 0;
    if (weatherData.windSpeed <= 3) {
      windScore = 15; // 理想的
    } else if (weatherData.windSpeed <= 6) {
      windScore = 12;
    } else if (weatherData.windSpeed <= 10) {
      windScore = 5;
    } else {
      windScore = 0; // 危険
    }

    // 気象条件スコア (0-12点)
    let conditionScore = 0;
    const weatherMain = weatherData.weather.main;

    if (weatherMain === 'Clear' || weatherMain === 'Sunny' || weatherMain === '晴れ') {
      conditionScore = 12;
    } else if (weatherMain === 'Clouds' || weatherMain === '曇り') {
      conditionScore = 8;
    } else if (weatherMain === 'Drizzle' || weatherMain === 'Mist' || weatherMain === '小雨') {
      conditionScore = 4;
    } else if (weatherMain === 'Rain' || weatherMain === '雨') {
      conditionScore = 2;
    } else if (
      weatherMain === 'Thunderstorm' ||
      weatherMain === 'Snow' ||
      weatherMain === '嵐' ||
      weatherMain === '雪'
    ) {
      conditionScore = 0;
    } else {
      conditionScore = 5; // デフォルト
    }

    // 気圧安定性スコア (0-8点) - 現在の気圧からの推測
    // 完全な気圧変化は計算できないため、固定値を使用
    let pressureScore = 8; // 安定していると仮定

    if (weatherData.pressure < 990 || weatherData.pressure > 1030) {
      pressureScore = 4; // やや不安定
    }

    return Math.min(35, windScore + conditionScore + pressureScore);
  }

  /**
   * 時間帯スコアを計算 (0-25点)
   */
  // 【廃止】時間帯スコアは潮汐タイミングスコアに統合されました
  // 理由：釣りで重要なのは、満潮・干潮の前後2時間という相対的なタイミング
  // 時間帯（朝・昼・夜）は潮汐タイミングに比べて影響が小さいため、
  // スコア配分を潮汐（65点）と天気（35点）に統合しました

  /**
   * スコアからランクを判定
   */
  private getRankFromScore(score: number): ScoreRank {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'fair';
    if (score >= 20) return 'poor';
    return 'bad';
  }

  /**
   * スコアに基づいて説明文を生成
   */
  private generateExplanation(
    score: number,
    bestComponent: 'tide' | 'weather' | 'time',
    weatherData: FormattedWeatherData,
  ): string {
    const rank = this.getRankFromScore(score);

    let explanation = '';

    switch (rank) {
      case 'excellent':
        explanation = '🟢 絶好調！釣りに最適な条件です。';
        break;
      case 'good':
        explanation = '🔵 好調です。釣りに良い条件です。';
        break;
      case 'fair':
        explanation = '🟡 普通です。釣れる可能性があります。';
        break;
      case 'poor':
        explanation = '🟠 厳しい条件です。釣りには不向きです。';
        break;
      case 'bad':
        explanation = '🔴 非常に悪い条件です。釣りをお勧めできません。';
        break;
    }

    // 最良要素を追加
    const bestLabel = this.getComponentLabel(bestComponent);
    explanation += `\n最も良い条件は${bestLabel}です。`;

    // 天気に関する追加情報
    if (weatherData.windSpeed > 10) {
      explanation += '\n⚠️ 風が強いため注意が必要です。';
    }

    return explanation;
  }

  /**
   * 要素のラベルを取得
   */
  private getComponentLabel(component: 'tide' | 'weather' | 'time'): string {
    switch (component) {
      case 'tide':
        return '潮汐';
      case 'weather':
        return '天気';
      case 'time':
        return '時間帯';
    }
  }

  /**
   * Dateオブジェクトを YYYY-MM-DD 形式の文字列に変換
   */
  private formatDateToString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

// シングルトンインスタンスをエクスポート
export const scoringEngine = new ScoringEngine();

/**
 * 釣りやすさスコアを計算するヘルパー関数
 */
export function calculateFishingScore(
  tideData: FormattedTideData,
  weatherData: FormattedWeatherData,
  currentTime: Date = new Date(),
): FishingScore {
  return scoringEngine.calculateFishingScore(tideData, weatherData, currentTime);
}
