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
    const timeScore = this.calculateTimeScore(weatherData, currentTime);

    // 総合スコア = 潮汐(40) + 天気(35) + 時間帯(25)
    const totalScore = tideScore + weatherScore + timeScore;

    // スコアをクリップ (0-100)
    const clippedScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    // ランクを判定
    const rank = this.getRankFromScore(clippedScore);

    // 最良・最悪要素を判定
    const components = {
      tide: tideScore,
      weather: weatherScore,
      time: timeScore,
    };

    const bestComponent = Object.entries(components).reduce((a, b) => (b[1] > a[1] ? b : a))[0] as
      | 'tide'
      | 'weather'
      | 'time';

    const worstComponent = Object.entries(components).reduce((a, b) => (b[1] < a[1] ? b : a))[0] as
      | 'tide'
      | 'weather'
      | 'time';

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
      return 20; // 中間値（40点満点の半分）
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
      return 20; // 中間値（40点満点の半分）
    }

    // 現在時刻に最も近い極値までの時間を計算
    let minDiff = Infinity;
    for (const extreme of allExtremes) {
      const diff = Math.abs(extreme.totalMinutes - currentTotalMinutes);
      minDiff = Math.min(minDiff, diff);
    }

    // 潮汐タイミングスコア (0-25点)
    // 満潮・干潮の前後2時間が釣りの最適時間帯
    let timingScore = 0;
    const minutesInHour = 60;
    const hoursFromExtreme = minDiff / minutesInHour;

    if (hoursFromExtreme <= 2) {
      // 前後2時間以内: 高スコア
      timingScore = 25 - hoursFromExtreme * 6.25; // 2時間で25点から12.5点に減少
    } else if (hoursFromExtreme <= 4) {
      // 前後4時間以内: 中スコア
      timingScore = 12.5 - (hoursFromExtreme - 2) * 6.25; // 4時間で12.5点から0点に減少
    } else {
      timingScore = 0;
    }

    // 潮の大きさスコア (0-15点)
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
      sizeScore = 15; // 大潮
    else if (tideRange >= 1.0)
      sizeScore = 12; // 中潮
    else if (tideRange >= 0.5)
      sizeScore = 8; // 小潮
    else sizeScore = 5; // 長潮・若潮

    return Math.min(40, timingScore + sizeScore);
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
   * 日の出・日の入り前後の時間帯で魚の活性度を評価
   */
  private calculateTimeScore(weatherData: FormattedWeatherData, currentTime: Date): number {
    const currentHour = currentTime.getHours();
    const currentMinutes = currentTime.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinutes;

    // 日の出・日の入り時刻を分単位で取得
    const sunriseHour = weatherData.sunrise.getHours();
    const sunriseMinutes = weatherData.sunrise.getMinutes();
    const sunriseTotalMinutes = sunriseHour * 60 + sunriseMinutes;

    const sunsetHour = weatherData.sunset.getHours();
    const sunsetMinutes = weatherData.sunset.getMinutes();
    const sunsetTotalMinutes = sunsetHour * 60 + sunsetMinutes;

    // 日の出・日の入りからの最短時間を計算（分単位）
    const diffFromSunrise = Math.abs(currentTotalMinutes - sunriseTotalMinutes);
    const diffFromSunset = Math.abs(currentTotalMinutes - sunsetTotalMinutes);
    const minDiff = Math.min(diffFromSunrise, diffFromSunset);

    // 時間を時間単位に変換
    const hoursFromSunEvent = minDiff / 60;

    // 日の出・日の入り前後でスコアを段階的に評価
    if (hoursFromSunEvent <= 1) {
      // ±1時間以内: 最高スコア
      return 25;
    } else if (hoursFromSunEvent <= 2) {
      // ±2時間以内: 中スコア
      return 15;
    } else if (hoursFromSunEvent <= 3) {
      // ±3時間以内: 低スコア
      return 5;
    }

    // それ以外: スコアなし
    return 0;
  }

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
