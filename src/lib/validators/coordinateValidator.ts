// 座標の丸め処理（小数点4桁 = 約11m精度）
export function roundCoordinate(value: number, precision = 4): number {
  return Math.round(value * 10 ** precision) / 10 ** precision;
}

// 文字列クエリパラメータをパース + バリデーション
export function parseAndValidateCoordinates(
  lat: string | null,
  lon: string | null,
): { lat: number; lon: number } | { error: string } {
  if (!lat || !lon) {
    return { error: '緯度(lat)と経度(lon)は必須パラメータです' };
  }
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
    return { error: '緯度と経度は有効な数値である必要があります' };
  }
  if (latNum < -90 || latNum > 90) {
    return { error: '緯度は-90から90の範囲である必要があります' };
  }
  if (lonNum < -180 || lonNum > 180) {
    return { error: '経度は-180から180の範囲である必要があります' };
  }
  return { lat: latNum, lon: lonNum };
}
