/**
 * 度分形式（DD.MM）を十進度に変換する。
 *
 * tide736.net API は座標を度分形式で返す。小数部は「分」であって十進度の端数ではない。
 * 例: 35.4 は 35度40分 = 35.6667度。そのまま十進度として扱うと最大約 44km 南西にずれる。
 *
 * @param value 度分形式の座標（例: 35.4）
 * @returns 十進度の座標（例: 35.6667）
 * @throws 有限数でない場合、または分が 60 以上で度分形式として解釈できない場合
 */
export function dmToDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`度分形式の座標が有限数ではありません: ${value}`);
  }

  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const degrees = Math.trunc(abs);
  // 0.46 → 46分。API は 139.460000000000007958 のような値を返すため、
  // また 0.31 * 100 が 30.999... になるため、Math.round で浮動小数の誤差を吸収する
  const minutes = Math.round((abs - degrees) * 100);

  if (minutes >= 60) {
    throw new Error(`度分形式の分が範囲外です: ${value}（分=${minutes}）`);
  }

  return sign * (degrees + minutes / 60);
}

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
