import { findLocationByCoordinates } from '@/lib/locationIdentity';
import { logger } from '@/lib/logger';
import { findNearestPort } from '@/lib/portMappingService';
import prisma from '@/lib/prisma';

const DEFAULT_PLACE = {
  name: '東京湾（芝浦）',
  latitude: 35.6419,
  longitude: 139.7483,
  prefectureCode: '13', // 東京都
  portCode: '2', // 芝浦港
};

export type LocationData = {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  prefectureCode: string;
  portCode: string;
  source?: {
    type: 'port' | 'coordinates';
    portId?: string;
    coordinates?: { lat: number; lng: number; name: string };
  };
};

/**
 * どの解決パターンにも当てはまらなかったときの地点。
 *
 * source を持たせないと、お気に入りボタンを押しても「何を登録すべきか」が
 * 分からず無反応になる（#78 と同じ原因）。
 */
export const DEFAULT_LOCATION: LocationData = {
  ...DEFAULT_PLACE,
  source: {
    type: 'coordinates',
    coordinates: {
      lat: DEFAULT_PLACE.latitude,
      lng: DEFAULT_PLACE.longitude,
      name: DEFAULT_PLACE.name,
    },
  },
};

export type DashboardSearchParams = {
  locationId?: string;
  portId?: string;
  lat?: string;
  lng?: string;
  name?: string;
};

/**
 * URLクエリパラメータから釣り場情報を解決する。
 * 優先順位: locationId > portId > lat&lng > デフォルト
 *
 * id の付与は resolveFromSearchParams ではなくここで一括して行う。
 * 解決パターンごとに書くと、新しいパターンを足したときに付け忘れて
 * 「登録済みなのにハートが灰色」が再発する（#78）。
 */
export async function resolveLocation(searchParams: DashboardSearchParams): Promise<LocationData> {
  const location = await resolveFromSearchParams(searchParams);

  if (location.id) {
    return location;
  }

  try {
    const existing = await findLocationByCoordinates(location.latitude, location.longitude);
    return existing ? { ...location, id: existing.id } : location;
  } catch (error) {
    // id が引けなくても画面は出す。ここで投げると、解決パターン側が DB 障害を
    // 握ってデフォルト地点に落としている意味が無くなり、ダッシュボード全体が落ちる。
    // 影響はお気に入りが未登録に見えることだけで、押せば API 側が正しく解決する
    logger.error({ err: error, name: location.name }, 'Error resolving existing location id');
    return location;
  }
}

async function resolveFromSearchParams(searchParams: DashboardSearchParams): Promise<LocationData> {
  // パターン0: locationId指定（お気に入りから遷移した場合など）
  if (searchParams.locationId) {
    try {
      const location = await prisma.locations.findUnique({
        where: { id: searchParams.locationId },
        include: { port: true },
      });

      if (!location) {
        logger.warn({ locationId: searchParams.locationId }, 'Location not found');
        return DEFAULT_LOCATION;
      }

      // portがある場合はそれを使用、ない場合は最寄りを検索
      let prefectureCode: string;
      let portCode: string;

      if (location.port) {
        prefectureCode = location.port.prefecture_code;
        portCode = location.port.port_code;
      } else {
        const nearestPort = await findNearestPort(location.latitude, location.longitude);
        if (!nearestPort) {
          logger.warn({ locationId: searchParams.locationId }, 'No nearest port found');
          return DEFAULT_LOCATION;
        }
        prefectureCode = nearestPort.prefecture_code;
        portCode = nearestPort.port_code;
      }

      return {
        id: location.id,
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        prefectureCode,
        portCode,
        source: {
          type: 'coordinates' as const,
          coordinates: {
            lat: location.latitude,
            lng: location.longitude,
            name: location.name,
          },
        },
      };
    } catch (error) {
      logger.error({ err: error, locationId: searchParams.locationId }, 'Error resolving location');
      return DEFAULT_LOCATION;
    }
  }

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
        source: {
          type: 'port' as const,
          portId: searchParams.portId,
        },
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
      if (
        Number.isNaN(lat) ||
        Number.isNaN(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        logger.warn({ lat: searchParams.lat, lng: searchParams.lng }, 'Invalid coordinates');
        return DEFAULT_LOCATION;
      }

      // 最寄り港を検索
      const nearestPort = await findNearestPort(lat, lng);
      if (nearestPort) {
        const locationName = searchParams.name || `指定地点 (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        return {
          name: locationName,
          latitude: lat,
          longitude: lng,
          prefectureCode: nearestPort.prefecture_code,
          portCode: nearestPort.port_code,
          source: {
            type: 'coordinates' as const,
            coordinates: { lat, lng, name: locationName },
          },
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
