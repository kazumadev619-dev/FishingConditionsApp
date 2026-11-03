import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 港座標は tide736.net から取らず、prisma/data/port-coordinates.csv を正とする（#345）。
// seed.ts は code.csv の港すべてについて、この CSV の座標を ports に入れる。
const rows = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .slice(1)
    .map((l) => l.split(','));

const ports = rows('code.csv');
const coords = rows('prisma/data/port-coordinates.csv');

describe('prisma/data/port-coordinates.csv', () => {
  it('code.csv と同じ 736 港を持つ', () => {
    expect(coords).toHaveLength(736);
    expect(ports).toHaveLength(736);
  });

  it('code.csv の全ての港に座標があり、余分な行がない', () => {
    const key = (r: string[]) => `${r[0]},${r[1]}`;
    expect(new Set(coords.map(key))).toEqual(new Set(ports.map(key)));
  });

  it('緯度・経度が有限で、範囲内にある', () => {
    for (const [pref, port, lat, lng] of coords) {
      // Number('') は 0 になるので、空欄は先に弾く
      expect(lat !== '' && lng !== '', `${pref}-${port} が空欄`).toBe(true);
      const la = Number(lat);
      const lo = Number(lng);
      expect(Number.isFinite(la) && la >= -90 && la <= 90, `${pref}-${port} lat=${lat}`).toBe(true);
      expect(Number.isFinite(lo) && lo >= -180 && lo <= 180, `${pref}-${port} lng=${lng}`).toBe(
        true,
      );
    }
  });
});
