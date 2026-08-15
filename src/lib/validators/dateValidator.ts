export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YYYY-MM-DD 形式であり、かつ実在する日付であることを検証する。
 *
 * DATE_REGEX だけでは形が合っているだけの `2026-99-99` や `2026-02-30` が
 * 通り、`new Date()` に渡すと Invalid Date になる。それを検出せず計算に
 * 進むと 400 ではなく NaN 混じりの結果が返る。
 */
export function isValidDateString(value: string): boolean {
  if (!DATE_REGEX.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  // 2026-02-30 は Date が 2026-03-02 へ繰り上げるため、往復させて一致を見る
  return parsed.toISOString().startsWith(value);
}

// UTC ベースの今日の日付文字列（YYYY-MM-DD）
// tide/route.ts での既存の toISOString().split('T')[0] と同等
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}
