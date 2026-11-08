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
