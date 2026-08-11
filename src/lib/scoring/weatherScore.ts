import type { FormattedWeatherData } from '../openWeatherService';

export function calculateWeatherScore(weatherData: FormattedWeatherData): number {
  let windScore = 0;
  if (weatherData.windSpeed <= 3) {
    windScore = 15;
  } else if (weatherData.windSpeed <= 6) {
    windScore = 12;
  } else if (weatherData.windSpeed <= 10) {
    windScore = 5;
  } else {
    windScore = 0;
  }

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
    conditionScore = 5;
  }

  let pressureScore = 8;
  if (weatherData.pressure < 990 || weatherData.pressure > 1030) {
    pressureScore = 4;
  }

  return Math.min(35, windScore + conditionScore + pressureScore);
}
