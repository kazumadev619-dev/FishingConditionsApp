/**
 * 「この座標は locations のどの行か」を決める唯一の規則。
 *
 * 同じ地点でも、ダッシュボード（表示時の id 解決）とお気に入り API（登録時の
 * id 解決）が別々の規則を持つと、実際には登録済みなのにダッシュボード側が
 * 「未登録」と判断し、POST /api/favorites が user_favorites の unique 制約に
 * ぶつかって 409 を返す（#78）。座標から locations を引く処理は必ずここを通す。
 */

import prisma from './prisma';
import { roundCoordinate } from './validators';

/**
 * 座標を locations の格納形式（小数点4桁 ≒ 約11m）に揃える。
 * locations への書き込みもこの丸めを通ったあとの値なので、検索側も同じ丸めが必要。
 */
export function toLocationCoordinates(latitude: number, longitude: number) {
  return {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  };
}

/**
 * 座標に対応する既存の locations を返す。無ければ null。
 * 作成はしない（作成するのはお気に入り登録時だけ）。
 */
export async function findLocationByCoordinates(latitude: number, longitude: number) {
  return prisma.locations.findFirst({
    where: toLocationCoordinates(latitude, longitude),
  });
}
