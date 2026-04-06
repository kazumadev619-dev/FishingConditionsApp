import type { FishingScore } from '@/types/scoring';
import type { FormattedWeatherData } from '../openWeatherService';
import type { FormattedTideData } from '../tideService';
import { formatDateLocal } from '../utils/dateUtils';
import { getScoreRank } from '../utils/scoreRank';
import { generateExplanation } from './explanationGenerator';
import { calculateTimeScore } from './timeScore';
import { calculateTideScore } from './tideScore';
import { calculateWeatherScore } from './weatherScore';

export class ScoringEngine {
  public calculateFishingScore(
    tideData: FormattedTideData,
    weatherData: FormattedWeatherData,
    currentTime: Date = new Date(),
  ): FishingScore {
    const tideScore = calculateTideScore(tideData, currentTime);
    const weatherScore = calculateWeatherScore(weatherData);
    const timeScore = calculateTimeScore(weatherData, currentTime);

    const totalScore = tideScore + weatherScore + timeScore;
    const clippedScore = Math.max(0, Math.min(100, Math.round(totalScore)));
    const rank = getScoreRank(clippedScore);

    const components = { tide: tideScore, weather: weatherScore, time: timeScore };

    const bestComponent = Object.entries(components).reduce((a, b) => (b[1] > a[1] ? b : a))[0] as
      | 'tide'
      | 'weather'
      | 'time';

    const worstComponent = Object.entries(components).reduce((a, b) => (b[1] < a[1] ? b : a))[0] as
      | 'tide'
      | 'weather'
      | 'time';

    const explanation = generateExplanation(
      clippedScore,
      bestComponent,
      weatherData,
      tideData,
      currentTime,
    );

    const today = formatDateLocal(currentTime);
    const todayTides = tideData.tides.find((t) => t.date === today);
    const tideName = todayTides?.daily.moon?.title;
    const moonAge = todayTides?.daily.moon?.age;

    return {
      score: clippedScore,
      rank,
      components,
      explanation,
      bestComponent,
      worstComponent,
      tideName,
      moonAge,
      calculatedAt: currentTime,
    };
  }
}

export const scoringEngine = new ScoringEngine();

export function calculateFishingScore(
  tideData: FormattedTideData,
  weatherData: FormattedWeatherData,
  currentTime: Date = new Date(),
): FishingScore {
  return scoringEngine.calculateFishingScore(tideData, weatherData, currentTime);
}
