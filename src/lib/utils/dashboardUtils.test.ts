import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime, formatTideEvent, formatTime } from './dashboardUtils';

// サーバー（コンテナは UTC）とブラウザ（JST など）で同じ文字列になること。
// 食い違うと hydration エラー #418 になる（#234）
describe('表示の時刻は実行環境のタイムゾーンに依存しない', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // 2026-10-16T20:48:27Z = JST 10/17 05:48:27
  const date = new Date('2026-10-16T20:48:27Z');

  for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    it(`TZ=${tz}`, () => {
      process.env.TZ = tz;
      expect(formatTime(date)).toBe('05:48');
      expect(formatDateTime(date)).toBe('2026/10/17 5:48:27');
      expect(formatTideEvent('2:05', 123)).toEqual({ time: '02:05', height: '1.2m' });
    });
  }
});
