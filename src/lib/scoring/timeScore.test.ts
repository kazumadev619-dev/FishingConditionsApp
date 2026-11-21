import { describe, expect, it } from 'vitest';
import type { FormattedWeatherData } from '../openWeatherService';
import { calculateTimeScore } from './timeScore';

// 期待値はすべて docs/reference/scoring-algorithm.md「時間帯スコア (0-25点)」の「評価基準」から決める。
// 日の出・日の入り ±1時間 25点 / ±2時間 15点 / ±3時間 5点 / それ以外 0点。時刻は JST。
// 守る状態: 日の出と日の入りの両方を基準にし、分単位の境目（ちょうど ±1h・±2h・±3h は上の段）で段が変わる。
const DATE = '2026-10-17';
const jst = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+09:00`);
const weatherOf = (sunrise: string, sunset: string) =>
  ({ sunrise: jst(sunrise), sunset: jst(sunset) }) as FormattedWeatherData;

// 日の出 06:30、日の入り 17:40。分が 0 でない値にして、分の取り込みも見る。
const weather = weatherOf('06:30', '17:40');

describe('calculateTimeScore の日の出側', () => {
  it.each([
    ['06:30', 25], // 日の出ちょうど
    ['07:30', 25], // +1時間ちょうどは 25点（以内）
    ['07:31', 15],
    ['08:30', 15], // +2時間ちょうどは 15点
    ['08:31', 5],
    ['09:30', 5], // +3時間ちょうどは 5点
    ['09:31', 0],
    ['05:30', 25], // 日の出より前も同じ幅
    ['05:29', 15],
    ['04:30', 15],
    ['04:29', 5],
    ['03:30', 5],
    ['03:29', 0],
  ])('日の出 06:30 に対して %s のとき %s 点', (now, score) => {
    expect(calculateTimeScore(weather, jst(now))).toBe(score);
  });
});

describe('calculateTimeScore の日の入り側', () => {
  it.each([
    ['17:40', 25],
    ['18:40', 25],
    ['18:41', 15],
    ['19:40', 15],
    ['19:41', 5],
    ['20:40', 5],
    ['20:41', 0],
    ['16:40', 25],
    ['16:39', 15],
    ['15:40', 15],
    ['15:39', 5],
    ['14:40', 5],
    ['14:39', 0],
  ])('日の入り 17:40 に対して %s のとき %s 点', (now, score) => {
    expect(calculateTimeScore(weather, jst(now))).toBe(score);
  });
});

describe('calculateTimeScore は近いほうの日の出・日の入りを基準にする', () => {
  it('日の出からも日の入りからも 3時間を超える時間帯は 0点', () => {
    expect(calculateTimeScore(weather, jst('12:00'))).toBe(0);
    expect(calculateTimeScore(weather, jst('00:00'))).toBe(0);
  });

  it('日の出から遠くても、日の入りに近ければ高い（その逆も）', () => {
    expect(calculateTimeScore(weather, jst('17:00'))).toBe(25); // 日の出から 10.5時間、日の入りから 40分
    expect(calculateTimeScore(weather, jst('07:00'))).toBe(25); // 日の入りから 10時間 40分、日の出から 30分
  });

  it('日の出と日の入りが近い日でも、近いほうの段になる', () => {
    expect(calculateTimeScore(weatherOf('11:00', '13:00'), jst('12:00'))).toBe(25);
    expect(calculateTimeScore(weatherOf('11:00', '13:00'), jst('14:30'))).toBe(15); // 日の入り 13:00 から 1.5時間
  });
});

// 時刻は JST で取る（同文書「基本ロジック」の getJapanDateTimeParts）。実行環境のタイムゾーンで取ると、UTC の本番でずれる。
describe('calculateTimeScore は日本時間で見る', () => {
  it('UTC で前日になる JST 0 時台も、その時刻として扱う', () => {
    // JST 00:30 = UTC 前日 15:30。日の出 01:00 に 30分 → 25点
    expect(calculateTimeScore(weatherOf('01:00', '18:00'), jst('00:30'))).toBe(25);
  });
});
