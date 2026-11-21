import { describe, expect, it } from 'vitest';
import { getScoreRank } from './scoreRank';

// 期待値は docs/reference/scoring-algorithm.md「スコア範囲と評価」の表から決める。
// excellent 80〜100 / good 60〜79 / fair 40〜59 / poor 20〜39 / bad 0〜19。
// 守る状態: 各ランクの下限（80・60・40・20）のちょうどが上のランクに入り、1 下は下のランクに入る。
describe('getScoreRank', () => {
  it.each([
    [100, 'excellent'],
    [80, 'excellent'],
    [79, 'good'],
    [60, 'good'],
    [59, 'fair'],
    [40, 'fair'],
    [39, 'poor'],
    [20, 'poor'],
    [19, 'bad'],
    [0, 'bad'],
  ])('スコア %s のとき %s', (score, rank) => {
    expect(getScoreRank(score)).toBe(rank);
  });
});
