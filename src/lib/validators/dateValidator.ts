export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// UTC ベースの今日の日付文字列（YYYY-MM-DD）
// tide/route.ts での既存の toISOString().split('T')[0] と同等
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}
