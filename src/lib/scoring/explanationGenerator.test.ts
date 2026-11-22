import { describe, expect, it } from 'vitest';
import type { FormattedWeatherData } from '../openWeatherService';
import type { FormattedTideData } from '../tideService';
import { generateExplanation } from './explanationGenerator';
import { calculateWeatherScore } from './weatherScore';

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
  it.each([0, 2, 6])('[T-EXPL-01] 風速 %sm/s では注意を出さない', (windSpeed) => {
    expect(generate(windSpeed)).not.toContain(WIND_WARNING);
  });

  it.each([6.0001, 6.1, 8, 10, 10.1, 20])('[T-EXPL-02] 風速 %sm/s では注意を出す', (windSpeed) => {
    expect(generate(windSpeed)).toContain(WIND_WARNING);
  });
});

// 反証テスト（PR #413）。仕様と差分だけを渡した別のエージェント（Opus: claude-opus-5-5）が提案し、取り込んだ。
// 仕様「0 点になる境目と同じ」: 注意の有無 = 風の点が 0 点か。Rain は 2 点、気圧 1013hPa は 8 点で、上限 35 に当たらない。
describe('[T-EXPL-03] generateExplanation の風の注意は、風の点が 0 点になる境目と一致する', () => {
  const rainy = (windSpeed: number) =>
    ({ windSpeed, pressure: 1013, weather: { main: 'Rain' } }) as FormattedWeatherData;
  // リテラルの境界（6 と 6 超）は上の describe が持つ。ここは weatherScore との一致だけを見る。
  const windPointIsZero = (windSpeed: number) =>
    calculateWeatherScore(rainy(windSpeed)) === calculateWeatherScore(rainy(100));

  it.each([0, 1.9, 2, 2.0001, 3.5, 4, 4.0001, 5.99, 6, 6.0001, 8, 10, 10.0001, 30])(
    '風速 %sm/s',
    (windSpeed) => {
      const explanation = generateExplanation(
        50,
        'tide',
        rainy(windSpeed),
        noTide,
        new Date('2026-01-01T00:00:00Z'),
      );
      expect(explanation.includes(WIND_WARNING)).toBe(windPointIsZero(windSpeed));
    },
  );
});

describe('generateExplanation の風の注意と、ほかの文の組み合わせ', () => {
  const withTide = {
    tides: [{ date: '2026-01-01', daily: { moon: { age: '14.2', title: '大潮' } } }],
  } as unknown as FormattedTideData;
  const at = (windSpeed: number) =>
    generateExplanation(
      55,
      'weather',
      { windSpeed } as FormattedWeatherData,
      withTide,
      new Date('2026-01-01T03:00:00Z'),
    );

  it('[T-EXPL-04] 潮名の文があっても、風の注意はちょうど 1 回足され、潮名の文は消えない', () => {
    const explanation = at(7);
    expect(explanation.split(WIND_WARNING)).toHaveLength(2);
    expect(explanation).toContain('大潮');
  });
});
