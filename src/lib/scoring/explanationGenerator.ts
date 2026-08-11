import type { FormattedWeatherData } from '../openWeatherService';
import type { FormattedTideData } from '../tideService';
import { formatDateLocal } from '../utils/dateUtils';
import { getScoreRank } from '../utils/scoreRank';

export function getComponentLabel(component: 'tide' | 'weather' | 'time'): string {
  switch (component) {
    case 'tide':
      return '潮汐';
    case 'weather':
      return '天気';
    case 'time':
      return '時間帯';
  }
}

export function generateExplanation(
  score: number,
  bestComponent: 'tide' | 'weather' | 'time',
  weatherData: FormattedWeatherData,
  tideData: FormattedTideData,
  currentTime: Date,
): string {
  const rank = getScoreRank(score);

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

  const bestLabel = getComponentLabel(bestComponent);
  explanation += `\n最も良い条件は${bestLabel}です。`;

  const today = formatDateLocal(currentTime);
  const todayTides = tideData.tides.find((t) => t.date === today);
  if (todayTides?.daily.moon) {
    const moonAge = todayTides.daily.moon.age;
    const tideName = todayTides.daily.moon.title;
    explanation += `\n🌙 本日は${tideName}です（月齢：${parseFloat(moonAge).toFixed(1)}）。`;
  }

  if (weatherData.windSpeed > 10) {
    explanation += '\n⚠️ 風が強いため注意が必要です。';
  }

  return explanation;
}
