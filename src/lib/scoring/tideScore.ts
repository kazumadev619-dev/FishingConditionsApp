import type { FormattedTideData } from '../tideService';
import { formatDateLocal } from '../utils/dateUtils';

export function calculateTideScore(tideData: FormattedTideData, currentTime: Date): number {
  const today = formatDateLocal(currentTime);
  const todayTides = tideData.tides.find((t) => t.date === today);

  if (!todayTides) {
    return 20;
  }

  const dailyTide = todayTides.daily;
  const currentHour = currentTime.getHours();
  const currentMinutes = currentTime.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinutes;

  const allExtremes = [
    ...dailyTide.flood.map((f) => ({
      time: f.time,
      type: 'flood' as const,
      height: f.cm,
    })),
    ...dailyTide.edd.map((e) => ({
      time: e.time,
      type: 'edd' as const,
      height: e.cm,
    })),
  ].map((e) => {
    const [hours, minutes] = e.time.split(':').map(Number);
    return { ...e, totalMinutes: hours * 60 + minutes };
  });

  const floods = allExtremes.filter((e) => e.type === 'flood');
  const edds = allExtremes.filter((e) => e.type === 'edd');

  if (floods.length === 0 || edds.length === 0) {
    return 20;
  }

  let minDiff = Infinity;
  for (const extreme of allExtremes) {
    const diff = Math.abs(extreme.totalMinutes - currentTotalMinutes);
    minDiff = Math.min(minDiff, diff);
  }

  let timingScore = 0;
  const hoursFromExtreme = minDiff / 60;

  if (hoursFromExtreme <= 2) {
    timingScore = 25 - hoursFromExtreme * 6.25;
  } else if (hoursFromExtreme <= 4) {
    timingScore = 12.5 - (hoursFromExtreme - 2) * 6.25;
  } else {
    timingScore = 0;
  }

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

  const tideRange = (nearestFlood.height - nearestEdd.height) / 100;

  let sizeScore = 0;
  if (tideRange >= 1.5) sizeScore = 15;
  else if (tideRange >= 1.0) sizeScore = 12;
  else if (tideRange >= 0.5) sizeScore = 8;
  else sizeScore = 5;

  return Math.min(40, timingScore + sizeScore);
}
