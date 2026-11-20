import { describe, expect, it } from 'vitest';
import type { FormattedWeatherData } from '../openWeatherService';
import type { FormattedTideData } from '../tideService';
import { generateExplanation } from './explanationGenerator';

// 守る状態: 風速が 6m/s を超えて風の点が 0 点になるとき、説明文に風の注意が出る。6m/s ちょうどでは出ない。
// 期待値: issue #401 とオーナーの決定（注意文の条件を、0 点の境目＝6m/s 超に揃える）。
// 0 点の境目は docs/reference/scoring-algorithm.md「風速評価」（6m/s 以下 5 点 / それ以外 0 点）。
const WIND_WARNING = '風が強いため注意が必要です。';
const noTide = { tides: [] } as unknown as FormattedTideData;
const generate = (windSpeed: number) =>
  generateExplanation(
    50,
    'tide',
    { windSpeed } as FormattedWeatherData,
    noTide,
    new Date('2026-01-01T00:00:00Z'),
  );

describe('generateExplanation の風の注意', () => {
  it.each([0, 2, 6])('風速 %sm/s では注意を出さない', (windSpeed) => {
    expect(generate(windSpeed)).not.toContain(WIND_WARNING);
  });

  it.each([6.1, 8, 10, 10.1, 20])('風速 %sm/s では注意を出す', (windSpeed) => {
    expect(generate(windSpeed)).toContain(WIND_WARNING);
  });
});
