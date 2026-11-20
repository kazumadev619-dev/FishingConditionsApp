import { describe, expect, it } from 'vitest';
import type { FormattedTideData } from '../tideService';
import { calculateTideScore } from './tideScore';

// 期待値はすべて docs/reference/scoring-algorithm.md「潮汐スコア (0-40点)」から決める。
// 時刻は JST（同文書「潮汐タイミング評価」）。潮汐データの cm を 100 で割って m にする（「潮の大きさ評価」）。

type Extreme = { time: string; cm: number };

const DATE = '2026-10-17';
const at = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+09:00`);

const tideOf = (flood: Extreme[], edd: Extreme[], date = DATE) =>
  ({
    tides: [
      {
        date,
        daily: {
          flood: flood.map((e) => ({ ...e, unix: 0 })),
          edd: edd.map((e) => ({ ...e, unix: 0 })),
        },
      },
    ],
  }) as unknown as FormattedTideData;

// 守る状態: 満潮・干潮の前後2時間が高く、4時間で0点になる。
// 期待値: 「潮汐タイミング評価」の式（2時間以内 25 - h*6.25、4時間以内 12.5 - (h-2)*6.25、それ以外 0）。
// 潮位差は 2.0m（15点）に固定し、もう一方の極値は 00:00 に置いて遠ざける。
describe('calculateTideScore の潮汐タイミング', () => {
  const tide = tideOf([{ time: '12:00', cm: 200 }], [{ time: '00:00', cm: 0 }]);

  it.each([
    ['12:00', 25],
    ['13:00', 18.75],
    ['10:00', 12.5], // 前2時間（前後どちらも同じ）
    ['14:00', 12.5],
    ['15:00', 6.25],
    ['16:00', 0],
    ['17:00', 0],
  ])('満潮 12:00 に対して %s のとき、タイミングは %s 点', (now, timing) => {
    expect(calculateTideScore(tide, at(now))).toBe(timing + 15);
  });

  it('干潮の時刻もタイミングの基準になる', () => {
    const lowAtNoon = tideOf([{ time: '00:00', cm: 200 }], [{ time: '12:00', cm: 0 }]);
    expect(calculateTideScore(lowAtNoon, at('12:00'))).toBe(25 + 15);
  });
});

// 守る状態: 潮位差の段階（1.5 / 1.0 / 0.5m、以上で上の段）。
// 期待値: 「潮の大きさ評価」の表。現在時刻を満潮に合わせ、タイミングを 25点に固定する。
// 25 + 15 = 40 は「潮汐スコア (0-40点)」の上限と一致する。
describe('calculateTideScore の潮の大きさ', () => {
  it.each([
    [200, 15],
    [150, 15],
    [149, 12],
    [100, 12],
    [99, 8],
    [50, 8],
    [49, 5],
    [0, 5],
  ])('潮位差 %scm のとき、潮の大きさは %s 点', (rangeCm, size) => {
    const tide = tideOf([{ time: '12:00', cm: rangeCm }], [{ time: '00:00', cm: 0 }]);
    expect(calculateTideScore(tide, at('12:00'))).toBe(25 + size);
  });

  // 「現在時刻に最も近い満潮の高さ − 現在時刻に最も近い干潮の高さ。その日の最高満潮と最低干潮ではない」
  it('潮位差は、その日の最高・最低ではなく、現在時刻に最も近い満潮と干潮から作る', () => {
    const tide = tideOf(
      [
        { time: '05:00', cm: 200 }, // その日の最高満潮（遠い）
        { time: '12:00', cm: 120 }, // 最も近い満潮
      ],
      [
        { time: '00:00', cm: 0 }, // その日の最低干潮（遠い）
        { time: '13:00', cm: 100 }, // 最も近い干潮
      ],
    );
    // 潮位差 0.2m で 5点。最高と最低を使うと 2.0m で 15点、片方だけでも 1.0m / 1.2m で 12点になる。
    expect(calculateTideScore(tide, at('12:00'))).toBe(25 + 5);
  });
});

// 守る状態: 当日の潮汐データがない、または満潮か干潮が当日にないときは 20点。
// 期待値: 「潮汐データがないとき」。
describe('calculateTideScore の潮汐データなし', () => {
  it('当日（JST）の潮汐データがないとき 20点', () => {
    const otherDay = tideOf([{ time: '12:00', cm: 200 }], [{ time: '00:00', cm: 0 }], '2026-10-16');
    expect(calculateTideScore(otherDay, at('12:00'))).toBe(20);
  });

  it('満潮が当日にないとき 20点', () => {
    expect(calculateTideScore(tideOf([], [{ time: '12:00', cm: 0 }]), at('12:00'))).toBe(20);
  });

  it('干潮が当日にないとき 20点', () => {
    expect(calculateTideScore(tideOf([{ time: '12:00', cm: 200 }], []), at('12:00'))).toBe(20);
  });
});
