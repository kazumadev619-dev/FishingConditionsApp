/**
 * 日付・時刻の基準にするタイムゾーン。釣り場も潮汐データ（HH:mm）も日本の時刻なので固定する。
 *
 * 実行環境のタイムゾーンに任せると、本番のコンテナ（UTC）では
 * - スコア計算が UTC の時・分を JST の潮汐の時刻と比べ、JST の 0〜9 時は前日の潮汐を使う（#296）
 * - サーバーが描画した HTML とブラウザ（JST）の最初の描画で文字列が食い違い、hydration エラー #418 になる（#234）
 */
export const JAPAN_TIME_ZONE = 'Asia/Tokyo';

// hourCycle: 'h23' で 0 時が 24（h24）や 12（en-CA 既定の h12）になる環境差を避ける
const japanDateTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: JAPAN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 日本時間の日付（YYYY-MM-DD）と時・分 */
export function getJapanDateTimeParts(date: Date): {
  date: string;
  hours: number;
  minutes: number;
} {
  const parts = japanDateTimeFormat.formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hours: Number(values.hour),
    minutes: Number(values.minute),
  };
}

export function formatDateInJapan(date: Date): string {
  return getJapanDateTimeParts(date).date;
}

// 日本語ロケール表示形式（dashboardUtils の formatDate 相当）
export function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('ja-JP', {
    timeZone: JAPAN_TIME_ZONE,
    month: 'long',
    day: 'numeric',
  });
}
