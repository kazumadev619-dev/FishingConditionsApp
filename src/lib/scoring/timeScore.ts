import type { FormattedWeatherData } from '../openWeatherService';
import { getJapanDateTimeParts } from '../utils/dateUtils';

export function calculateTimeScore(weatherData: FormattedWeatherData, currentTime: Date): number {
  const { hours: currentHour, minutes: currentMinutes } = getJapanDateTimeParts(currentTime);
  const currentTotalMinutes = currentHour * 60 + currentMinutes;

  const { hours: sunriseHour, minutes: sunriseMinutes } = getJapanDateTimeParts(
    weatherData.sunrise,
  );
  const sunriseTotalMinutes = sunriseHour * 60 + sunriseMinutes;

  const { hours: sunsetHour, minutes: sunsetMinutes } = getJapanDateTimeParts(weatherData.sunset);
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
