/**
 * 港マッピングサービス
 * 任意の緯度経度から最寄りの潮汐観測港を検索する
 */

import prisma from '@/lib/prisma';
import type { ports } from '@/generated/prisma/client';

/**
 * 港と距離の情報
 */
export type PortWithDistance = ports & {
  distance: number;
};

/**
 * Haversine公式を使用して2点間の距離を計算（km）
 * @param lat1 地点1の緯度
 * @param lon1 地点1の経度
 * @param lat2 地点2の緯度
 * @param lon2 地点2の経度
 * @returns 距離（km）
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // 地球の半径（km）
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 指定された緯度経度から最寄りの港を検索
 * @param latitude 緯度（-90 ~ 90）
 * @param longitude 経度（-180 ~ 180）
 * @returns 最寄りの港情報と距離、見つからない場合はnull
 * @throws {Error} 緯度経度が範囲外の場合
 */
export async function findNearestPort(
  latitude: number,
  longitude: number,
): Promise<PortWithDistance | null> {
  // 入力値バリデーション
  if (latitude < -90 || latitude > 90) {
    throw new Error(`緯度が範囲外です: ${latitude} (有効範囲: -90 ~ 90)`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error(`経度が範囲外です: ${longitude} (有効範囲: -180 ~ 180)`);
  }

  // 緯度経度が設定されている港のみ取得
  const allPorts = await prisma.ports.findMany({
    where: {
      latitude: { not: null },
      longitude: { not: null },
    },
  });

  if (allPorts.length === 0) {
    return null;
  }

  // 各港との距離を計算してソート
  const portsWithDistance: PortWithDistance[] = allPorts
    .map((port) => ({
      ...port,
      distance: calculateDistance(latitude, longitude, port.latitude!, port.longitude!),
    }))
    .sort((a, b) => a.distance - b.distance);

  return portsWithDistance[0];
}
