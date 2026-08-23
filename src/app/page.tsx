import { DashboardGrid } from '@/components/organisms/DashboardGrid';
import { getCurrentWeather } from '@/lib/openWeatherService';
import { calculateFishingScore } from '@/lib/scoringService';
import { getTideData } from '@/lib/tideService';
import { getTimeCategory, getTimeExplanation } from '@/lib/utils/dashboardUtils';
import type { DashboardData } from '@/types/dashboard';

export const dynamic = 'force-dynamic';

const DEFAULT_LOCATION = {
  name: '東京湾（芝浦）',
  latitude: 35.6895,
  longitude: 139.6917,
  prefectureCode: '13', // 東京都
  portCode: '2', // 芝浦港
};

export default async function Home() {
  const currentTime = new Date();
  const today = currentTime.toISOString().split('T')[0];

  const weatherResponse = await getCurrentWeather(
    DEFAULT_LOCATION.latitude,
    DEFAULT_LOCATION.longitude,
  );
  const tideResponse = await getTideData(
    DEFAULT_LOCATION.prefectureCode,
    DEFAULT_LOCATION.portCode,
    today,
  );

  const weatherData = weatherResponse.data;
  const tideData = tideResponse.data;

  const fishingScore = calculateFishingScore(tideData, weatherData, currentTime);

  const todayTideData = tideData.tides.find((t: { date: string }) => t.date === today);

  if (!todayTideData) {
    throw new Error('本日の潮汐データが見つかりません');
  }

  const dashboardData: DashboardData = {
    location: DEFAULT_LOCATION,
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

  return <DashboardGrid data={dashboardData} location={DEFAULT_LOCATION} />;
}
