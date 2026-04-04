// YYYY-MM-DD形式（ローカルタイムベース）
// toISOString() は UTC ベースで日本（UTC+9）では午前0〜9時に前日の日付を返すため、
// 潮汐データの日付マッチングにはローカルタイムが必要。
export function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 日本語ロケール表示形式（dashboardUtils の formatDate 相当）
export function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}
