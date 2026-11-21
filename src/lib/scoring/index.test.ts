import { describe, expect, it } from 'vitest';
import type { FormattedWeatherData } from '../openWeatherService';
import type { FormattedTideData } from '../tideService';
import { calculateFishingScore } from './index';

// 期待値は docs/reference/scoring-algorithm.md から決める。
//  - 総合スコア = 潮汐 (40) + 天気 (35) + 時間帯 (25)（「スコア算出概要」）
//  - 合計は四捨五入して 0〜100 に収める。components の各値は丸めない（「合計の丸め」）
//  - ランクは「スコア範囲と評価」の表。ランクの元になるのは丸めたあとの総合スコア
//  - bestComponent / worstComponent は components のうち最も高い / 低い要素（「スコア内訳表示」）
// 各要素の点数そのものは tideScore / weatherScore / timeScore のテストが見る。ここは、組み合わせ方だけを見る。
//
// 要素の点数を作る手がかり（現在時刻は JST 2026-10-17 12:00）:
//   潮汐 40 = 満潮が 12:00・潮位差 1.5m、20 = 当日の潮汐データなし（「潮汐データがないとき」）、5 = 極値が 4時間超先で潮位差 0.5m 未満
//   天気 35 = 風 0m/s・Clear・1013hPa、8 = 風 7m/s（0点）・Thunderstorm（0点）・1013hPa（8点）、4 = 同・1040hPa（4点）
//   時間帯 25 = 日の出 12:00、5 = 日の出 09:00（3時間前）かつ日の入り 20:00、0 = 日の出 05:00・日の入り 18:00（6時間差）
const DATE = '2026-10-17';
const NOW = new Date(`${DATE}T12:00:00+09:00`);
const jst = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+09:00`);

const tideFor = (flood: string, cm: number, moon?: { age: string; title: string }) =>
  ({
    tides: [
      {
        date: DATE,
        daily: {
          flood: [{ time: flood, cm, unix: 0 }],
          edd: [{ time: '00:00', cm: 0, unix: 0 }],
          moon,
        },
      },
    ],
  }) as unknown as FormattedTideData;
const TIDE_40 = tideFor('12:00', 150);
const TIDE_20 = { tides: [] } as unknown as FormattedTideData;
const TIDE_5 = {
  tides: [
    {
      date: DATE,
      daily: {
        flood: [{ time: '20:00', cm: 10, unix: 0 }],
        edd: [{ time: '21:00', cm: 0, unix: 0 }],
      },
    },
  ],
} as unknown as FormattedTideData;

const weatherOf = (
  windSpeed: number,
  main: string,
  pressure: number,
  sunrise: string,
  sunset: string,
) =>
  ({
    windSpeed,
    pressure,
    weather: { main },
    sunrise: jst(sunrise),
    sunset: jst(sunset),
  }) as FormattedWeatherData;
const SUN_25 = ['12:00', '18:00'] as const;
const SUN_5 = ['09:00', '20:00'] as const;
const SUN_0 = ['05:00', '18:00'] as const;
const W_35 = (sun: readonly [string, string]) => weatherOf(0, 'Clear', 1013, ...sun);
const W_8 = (sun: readonly [string, string]) => weatherOf(7, 'Thunderstorm', 1013, ...sun);
const W_4 = (sun: readonly [string, string]) => weatherOf(7, 'Thunderstorm', 1040, ...sun);

describe('calculateFishingScore の bestComponent と worstComponent', () => {
  it.each([
    [
      '潮汐が最高・時間帯が最低',
      TIDE_40,
      W_8(SUN_0),
      { tide: 40, weather: 8, time: 0 },
      'tide',
      'time',
    ],
    [
      '天気が最高・時間帯が最低',
      TIDE_20,
      W_35(SUN_0),
      { tide: 20, weather: 35, time: 0 },
      'weather',
      'time',
    ],
    [
      '時間帯が最高・天気が最低',
      TIDE_20,
      W_8(SUN_25),
      { tide: 20, weather: 8, time: 25 },
      'time',
      'weather',
    ],
    [
      '天気が最高・潮汐が最低',
      TIDE_20,
      W_35(SUN_25),
      { tide: 20, weather: 35, time: 25 },
      'weather',
      'tide',
    ],
    [
      '潮汐が最高・天気が最低',
      TIDE_40,
      W_8(SUN_25),
      { tide: 40, weather: 8, time: 25 },
      'tide',
      'weather',
    ],
    [
      '時間帯が最高・潮汐が最低',
      TIDE_5,
      W_8(SUN_25),
      { tide: 5, weather: 8, time: 25 },
      'time',
      'tide',
    ],
  ] as const)('%s', (_name, tide, weather, components, best, worst) => {
    const result = calculateFishingScore(tide, weather, NOW);

    expect(result.components).toEqual(components);
    expect(result.bestComponent).toBe(best);
    expect(result.worstComponent).toBe(worst);
  });
});

describe('calculateFishingScore の合計とランク', () => {
  it('3つの要素の合計になり、そのスコアのランクになる', () => {
    const result = calculateFishingScore(TIDE_20, W_8(SUN_25), NOW);

    expect(result.score).toBe(53); // 20 + 8 + 25
    expect(result.rank).toBe('fair');
  });

  it('満点は 100 点で excellent、最低の組み合わせ（5 + 4 + 0）は 9 点で bad', () => {
    const best = calculateFishingScore(TIDE_40, W_35(SUN_25), NOW);
    expect(best).toMatchObject({ score: 100, rank: 'excellent' });
    expect(best.components).toEqual({ tide: 40, weather: 35, time: 25 });

    const worst = calculateFishingScore(TIDE_5, W_4(SUN_0), NOW);
    expect(worst).toMatchObject({ score: 9, rank: 'bad' });
    expect(worst.components).toEqual({ tide: 5, weather: 4, time: 0 });
  });

  // 潮汐タイミングは 25 - (極値までの分 / 60) * 6.25。満潮が 12:00 の m 分後だと 25 - m * 0.1041666…
  it('合計は四捨五入する（切り捨て・切り上げにしない）が、components は丸めない', () => {
    // 4分: 潮汐 39.5833 + 35 + 25 = 99.5833 → 100（切り捨てなら 99）
    const up = calculateFishingScore(tideFor('12:04', 150), W_35(SUN_25), NOW);
    expect(up.score).toBe(100);
    expect(up.components.tide).toBeCloseTo(39.5833, 4);

    // 5分: 潮汐 39.4792 + 35 + 25 = 99.4792 → 99（切り上げなら 100）
    const down = calculateFishingScore(tideFor('12:05', 150), W_35(SUN_25), NOW);
    expect(down.score).toBe(99);
    expect(down.components.tide).toBeCloseTo(39.4792, 4);
  });

  it('ちょうど .5 は切り上げる（四捨五入）', () => {
    // 24分: 潮汐 22.5 + 15 = 37.5。37.5 + 35 + 25 = 97.5 → 98（.5 を切り捨てる丸めなら 97）
    const result = calculateFishingScore(tideFor('12:24', 150), W_35(SUN_25), NOW);

    expect(result.components.tide).toBeCloseTo(37.5, 6);
    expect(result.score).toBe(98);
  });

  it('ランクは丸めたあとのスコアで決める（79.79 は 80 になり excellent）', () => {
    // 2分: 潮汐 39.7917 + 35 + 5 = 79.7917 → 80。丸める前の値で判定すると good になる
    const result = calculateFishingScore(tideFor('12:02', 150), W_35(SUN_5), NOW);

    expect(result.score).toBe(80);
    expect(result.rank).toBe('excellent');
  });
});

describe('calculateFishingScore の潮名・月齢・計算時刻', () => {
  it('当日の潮汐データの moon.title と moon.age を tideName と moonAge に入れる', () => {
    const tide = tideFor('12:00', 150, { age: '14.2', title: '大潮' });
    const result = calculateFishingScore(tide, W_35(SUN_25), NOW);

    expect(result.tideName).toBe('大潮');
    expect(result.moonAge).toBe('14.2');
    expect(result.calculatedAt).toBe(NOW);
  });

  // 「tideName: 当日の tide736 の moon.title」「moonAge: 当日の moon.age」。前日が先頭にあっても当日を選ぶ
  it('tideName と moonAge は前日ではなく当日（JST）の moon から取る', () => {
    const day = (date: string, moon: { age: string; title: string }) => ({
      date,
      daily: {
        flood: [{ time: '12:00', cm: 150, unix: 0 }],
        edd: [{ time: '00:00', cm: 0, unix: 0 }],
        moon,
      },
    });
    const tide = {
      tides: [
        day('2026-10-16', { age: '13.2', title: '中潮' }),
        day(DATE, { age: '14.2', title: '大潮' }),
      ],
    } as unknown as FormattedTideData;
    const result = calculateFishingScore(tide, W_35(SUN_25), NOW);

    expect(result.tideName).toBe('大潮');
    expect(result.moonAge).toBe('14.2');
  });

  it('当日の潮汐データがなければ tideName と moonAge は無い', () => {
    const result = calculateFishingScore(TIDE_20, W_35(SUN_25), NOW);

    expect(result.tideName).toBeUndefined();
    expect(result.moonAge).toBeUndefined();
  });
});
