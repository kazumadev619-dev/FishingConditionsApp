import { describe, expectTypeOf, it } from 'vitest';
import type { Jsonified } from './types';

// 型テスト: tsc（npm run type-check）が検査する
describe('Jsonified', () => {
  it('Date を文字列にし、ネストと配列とタプルの中まで辿る', () => {
    expectTypeOf<Jsonified<{ at: Date; list: Date[]; pair: [Date, number] }>>().toEqualTypeOf<{
      at: string;
      list: string[];
      pair: [string, number];
    }>();
  });

  it('optional と union を保つ', () => {
    expectTypeOf<Jsonified<{ at?: Date; maybe: Date | null }>>().toEqualTypeOf<{
      at?: string;
      maybe: string | null;
    }>();
  });

  it('Map / Set は空オブジェクト、関数は undefined になる', () => {
    expectTypeOf<
      Jsonified<{ map: Map<string, number>; set: Set<number>; fn: () => void }>
    >().toEqualTypeOf<{
      map: Record<string, never>;
      set: Record<string, never>;
      fn: undefined;
    }>();
  });
});
