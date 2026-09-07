import { describe, expect, it } from 'vitest';
import { dmToDegrees } from './coordinateValidator';

describe('dmToDegrees', () => {
  // tide736.net API から実測した値と、国土地理院基準の実際の座標の対応。
  // 例: 築地は API が 35.4 / 139.46 を返すが、これは 35度40分 / 139度46分 の意味。
  it.each([
    { port: '築地', dm: 35.4, expected: 35.6667 },
    { port: '築地(経度)', dm: 139.46, expected: 139.7667 },
    { port: '石垣', dm: 24.2, expected: 24.3333 },
    { port: '石垣(経度)', dm: 124.1, expected: 124.1667 },
    { port: '塩浜運河', dm: 35.31, expected: 35.5167 },
    { port: '塩浜運河(経度)', dm: 139.45, expected: 139.75 },
    { port: '西海岸', dm: 33.56, expected: 33.9333 },
    { port: '西海岸(経度)', dm: 130.58, expected: 130.9667 },
    { port: '大津', dm: 36.5, expected: 36.8333 },
    { port: '大津(経度)', dm: 140.48, expected: 140.8 },
    { port: '的矢', dm: 34.22, expected: 34.3667 },
    { port: '的矢(経度)', dm: 136.52, expected: 136.8667 },
    { port: '我喜屋', dm: 27.02, expected: 27.0333 },
    { port: '我喜屋(経度)', dm: 127.58, expected: 127.9667 },
  ])('$port: $dm → $expected', ({ dm, expected }) => {
    expect(dmToDegrees(dm)).toBeCloseTo(expected, 4);
  });

  it('小数第1位までの値は「分の10の位」として解釈する（35.4 は 4分ではなく 40分）', () => {
    expect(dmToDegrees(35.4)).toBeCloseTo(35 + 40 / 60, 10);
    expect(dmToDegrees(35.04)).toBeCloseTo(35 + 4 / 60, 10);
  });

  it('API が返す浮動小数の誤差を吸収する', () => {
    // tide736.net の生レスポンス（築地）をそのまま JSON.parse したもの。
    // API は 35.39999999999999857891... という桁数で返してくる。
    // 数値リテラルで書くと精度が落ちて意図がぼやけるため、実際の経路を通す。
    const raw = JSON.parse(
      '{"latitude":35.39999999999999857891452847979962825775146484375,' +
        '"longitude":139.460000000000007958078640513122081756591796875}',
    ) as { latitude: number; longitude: number };

    expect(dmToDegrees(raw.latitude)).toBeCloseTo(35 + 40 / 60, 10);
    expect(dmToDegrees(raw.longitude)).toBeCloseTo(139 + 46 / 60, 10);

    // 0.31 * 100 が 30.999... になるケース
    expect(dmToDegrees(35.31)).toBeCloseTo(35 + 31 / 60, 10);
  });

  it('分が 0 のときは度をそのまま返す', () => {
    expect(dmToDegrees(35)).toBe(35);
    expect(dmToDegrees(0)).toBe(0);
  });

  it('負の座標は符号を保ったまま変換する', () => {
    expect(dmToDegrees(-35.4)).toBeCloseTo(-(35 + 40 / 60), 10);
  });

  it('分が 60 以上の値は度分形式ではないので例外にする', () => {
    expect(() => dmToDegrees(35.6)).toThrow(/分/);
    expect(() => dmToDegrees(35.99)).toThrow(/分/);
  });

  it('数値でない値は例外にする', () => {
    expect(() => dmToDegrees(Number.NaN)).toThrow();
    expect(() => dmToDegrees(Number.POSITIVE_INFINITY)).toThrow();
  });
});
