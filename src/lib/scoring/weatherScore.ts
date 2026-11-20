import type { FormattedWeatherData } from '../openWeatherService';

/** 風速がこれを超えると、風の点は 0 点（説明文の風の注意もこの境目で出す）。 */
export const WIND_ZERO_POINT_ABOVE = 6;

export function calculateWeatherScore(weatherData: FormattedWeatherData): number {
  let windScore: number;
  if (weatherData.windSpeed <= 2) {
    windScore = 15;
  } else if (weatherData.windSpeed <= 4) {
    windScore = 10;
  } else if (weatherData.windSpeed <= WIND_ZERO_POINT_ABOVE) {
    windScore = 5;
  } else {
    windScore = 0;
  }

  let conditionScore: number;
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
    conditionScore = 5;
  }

  let pressureScore = 8;
  if (weatherData.pressure < 990 || weatherData.pressure > 1030) {
    pressureScore = 4;
  }

  return Math.min(35, windScore + conditionScore + pressureScore);
}
