import type { FormattedWeatherData } from '../openWeatherService';

export function calculateTimeScore(weatherData: FormattedWeatherData, currentTime: Date): number {
  const currentHour = currentTime.getHours();
  const currentMinutes = currentTime.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinutes;

  const sunriseHour = weatherData.sunrise.getHours();
  const sunriseMinutes = weatherData.sunrise.getMinutes();
  const sunriseTotalMinutes = sunriseHour * 60 + sunriseMinutes;

  const sunsetHour = weatherData.sunset.getHours();
  const sunsetMinutes = weatherData.sunset.getMinutes();
  const sunsetTotalMinutes = sunsetHour * 60 + sunsetMinutes;

  const diffFromSunrise = Math.abs(currentTotalMinutes - sunriseTotalMinutes);
  const diffFromSunset = Math.abs(currentTotalMinutes - sunsetTotalMinutes);
  const minDiff = Math.min(diffFromSunrise, diffFromSunset);

  const hoursFromSunEvent = minDiff / 60;

  if (hoursFromSunEvent <= 1) {
    return 25;
  } else if (hoursFromSunEvent <= 2) {
    return 15;
  } else if (hoursFromSunEvent <= 3) {
    return 5;
  }

  return 0;
}
