// キャッシュのTTL定数（秒単位）
export const CACHE_TTL = {
  WEATHER: 30 * 60, // 30分
  TIDE: 6 * 60 * 60, // 6時間
  LOCATION: 60 * 60, // 1時間
  // スコアは天気と潮汐の合成。最も動きの速い入力が天気（30分）なので、
  // それより長く保持しても中身が古くなるだけで意味がない。
  SCORE: 30 * 60, // 30分
} as const;

// キャッシュキーのプレフィックス
export const CACHE_PREFIX = {
  WEATHER: 'weather',
  TIDE: 'tide',
  LOCATION: 'location',
  // スコアを weather に相乗りさせない。相乗りしていると
  // weather:* の一括削除がスコアまで消し、weather 向けの TTL 変更が
  // スコアにも波及する。どちらかにパラメータが増えるとキー形状が衝突しうる。
  SCORE: 'score',
} as const;
