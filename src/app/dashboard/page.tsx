import { DashboardGrid } from '@/components/organisms/DashboardGrid';
import { calculateFishingScore } from '@/lib/scoringService';
import { getCurrentWeather } from '@/lib/openWeatherService';
import { getTideData } from '@/lib/tideService';
import { getTimeCategory, getTimeExplanation } from '@/lib/utils/dashboardUtils';
import type { DashboardData } from '@/types/dashboard';
import prisma from '@/lib/prisma';
import { findNearestPort } from '@/lib/portMappingService';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const DEFAULT_LOCATION = {
  name: '東京湾（芝浦）',
  latitude: 35.6419,
  longitude: 139.7483,
  prefectureCode: '13', // 東京都
  portCode: '2', // 芝浦港
};

type LocationData = {
  name: string;
  latitude: number;
  longitude: number;
  prefectureCode: string;
  portCode: string;
};

/**
 * URLクエリパラメータから釣り場情報を解決
 * 優先順位: portId > lat&lng > デフォルト
 */
async function resolveLocation(searchParams: {
  portId?: string;
  lat?: string;
  lng?: string;
  name?: string;
}): Promise<LocationData> {
  // パターン1: portId指定
  if (searchParams.portId) {
    try {
      const port = await prisma.ports.findUnique({
        where: { id: searchParams.portId },
      });

      if (!port) {
        logger.warn({ portId: searchParams.portId }, 'Port not found');
        return DEFAULT_LOCATION;
      }

      if (!port.latitude || !port.longitude) {
        logger.warn({ portId: searchParams.portId }, 'Port has no coordinates');
        return DEFAULT_LOCATION;
      }

      return {
        name: port.name,
        latitude: port.latitude,
        longitude: port.longitude,
        prefectureCode: port.prefecture_code,
        portCode: port.port_code,
      };
    } catch (error) {
      logger.error({ err: error, portId: searchParams.portId }, 'Error resolving port');
      return DEFAULT_LOCATION;
    }
  }

  // パターン2: lat&lng指定
  if (searchParams.lat && searchParams.lng) {
    try {
      const lat = parseFloat(searchParams.lat);
      const lng = parseFloat(searchParams.lng);

      // バリデーション
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        logger.warn({ lat: searchParams.lat, lng: searchParams.lng }, 'Invalid coordinates');
        return DEFAULT_LOCATION;
      }

      // 最寄り港を検索
      const nearestPort = await findNearestPort(lat, lng);
      if (nearestPort) {
        return {
          name: searchParams.name || `指定地点 (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          latitude: lat,
          longitude: lng,
          prefectureCode: nearestPort.prefecture_code,
          portCode: nearestPort.port_code,
        };
      }

      // 最寄り港が見つからない場合はデフォルト
      logger.warn({ lat, lng }, 'No nearest port found for coordinates');
      return DEFAULT_LOCATION;
    } catch (error) {
      logger.error(
        { err: error, lat: searchParams.lat, lng: searchParams.lng },
        'Error resolving coordinates',
      );
      return DEFAULT_LOCATION;
    }
  }

  // パターン3: デフォルト
  return DEFAULT_LOCATION;
}

type PageProps = {
  searchParams: Promise<{
    portId?: string;
    lat?: string;
    lng?: string;
    name?: string;
  }>;
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

  // キャッシュから取得した場合、Dateオブジェクトが文字列になっているので変換
  weatherData.sunrise = new Date(weatherData.sunrise);
  weatherData.sunset = new Date(weatherData.sunset);
  weatherData.dataTime = new Date(weatherData.dataTime);

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

  return <DashboardGrid data={dashboardData} />;
}
