import { describe, expect, it } from 'vitest';
import type { FormattedWeatherData } from '../openWeatherService';
import { calculateWeatherScore } from './weatherScore';

// 守る状態: 風速によって、天気スコアが段階的に下がる。
// 期待値: docs/reference/scoring-algorithm.md「風速評価」（2m/s 以下 15 / 4m/s 以下 10 / 6m/s 以下 5 / それ以外 0。#367 でユーザーが決めた値）。
// 天候は Clear（12点）、気圧は 1013hPa（8点）に固定するので、合計は 風速のスコア + 20 になる（同文書の「天候評価」「気圧評価」）。
const weatherWith = (windSpeed: number) =>
  ({
    windSpeed,
    pressure: 1013,
    weather: { main: 'Clear' },
  }) as FormattedWeatherData;

describe('calculateWeatherScore の風速', () => {
  it.each([
    [0, 15],
    [2, 15],
    [2.1, 10],
    [4, 10],
    [4.1, 5],
    [6, 5],
    [6.1, 0],
    [20, 0],
  ])('風速 %sm/s のとき、風速のスコアは %s 点', (windSpeed, windScore) => {
    expect(calculateWeatherScore(weatherWith(windSpeed))).toBe(windScore + 20);
  });
});

// 風速は 0m/s（15点）に固定する。docs/reference/scoring-algorithm.md「風速評価」。
const weatherOf = (main: string, pressure: number) =>
  ({ windSpeed: 0, pressure, weather: { main } }) as FormattedWeatherData;

// 守る状態: 天候の分類（英語・日本語の表記）ごとに点数が決まる。
// 期待値: docs/reference/scoring-algorithm.md「天候評価」。気圧 1013hPa（8点）と風速 15点を足して 23 + 天候の点数。
describe('calculateWeatherScore の天候', () => {
  it.each([
    ['Clear', 12],
    ['Sunny', 12],
    ['晴れ', 12],
    ['Clouds', 8],
    ['曇り', 8],
    ['Drizzle', 4],
    ['Mist', 4],
    ['小雨', 4],
    ['Rain', 2],
    ['雨', 2],
    ['Thunderstorm', 0],
    ['Snow', 0],
    ['嵐', 0],
    ['雪', 0],
    ['Haze', 5], // 「上記以外」
  ])('天候 %s のとき、天候のスコアは %s 点', (main, conditionScore) => {
    expect(calculateWeatherScore(weatherOf(main, 1013))).toBe(23 + conditionScore);
  });
});

// 守る状態: 990hPa 以上 1030hPa 以下が安定（8点）、それ以外は不安定（4点）。
// 期待値: docs/reference/scoring-algorithm.md「気圧評価」。風速 15点と Clear 12点を足して 27 + 気圧の点数。
// 満点 15 + 12 + 8 = 35 は「天気スコア (0-35点)」の上限と一致する。
describe('calculateWeatherScore の気圧', () => {
  it.each([
    [960, 4],
    [989.9, 4],
    [990, 8],
    [1013, 8],
    [1030, 8],
    [1030.1, 4],
    [1050, 4],
  ])('気圧 %shPa のとき、気圧のスコアは %s 点', (pressure, pressureScore) => {
    expect(calculateWeatherScore(weatherOf('Clear', pressure))).toBe(27 + pressureScore);
  });
});
