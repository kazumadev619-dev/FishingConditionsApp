import { DashboardGrid } from '@/components/organisms/DashboardGrid';
import { getCurrentWeather } from '@/lib/openWeatherService';
import { calculateFishingScore } from '@/lib/scoringService';
import { getTideData } from '@/lib/tideService';
import { getTimeCategory, getTimeExplanation } from '@/lib/utils/dashboardUtils';
import type { DashboardData } from '@/types/dashboard';
import { type DashboardSearchParams, resolveLocation } from './resolveLocation';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<DashboardSearchParams>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentTime = new Date();
  const today = currentTime.toISOString().split('T')[0];

  // URLクエリパラメータから釣り場情報を解決
  const location = await resolveLocation(params);

  const weatherResponse = await getCurrentWeather(location.latitude, location.longitude);
  const tideResponse = await getTideData(location.prefectureCode, location.portCode, today);

  const weatherData = weatherResponse.data;
  const tideData = tideResponse.data;

  const fishingScore = calculateFishingScore(tideData, weatherData, currentTime);

  const todayTideData = tideData.tides.find((t: { date: string }) => t.date === today);

  if (!todayTideData) {
    throw new Error('本日の潮汐データが見つかりません');
  }

  const dashboardData: DashboardData = {
    location,
    fishingScore,
    tideData,
    todayTide: todayTideData.daily,
    weatherData,
    timeScore: {
      score: fishingScore.components.time,
      currentTime,
      sunrise: weatherData.sunrise,
      sunset: weatherData.sunset,
      timeCategory: getTimeCategory(fishingScore.components.time),
      explanation: getTimeExplanation(fishingScore.components.time),
    },
  };

  return <DashboardGrid data={dashboardData} location={location} />;
}
