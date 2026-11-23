import { describe, expect, it } from 'vitest';
import { getScoreRank } from './scoreRank';

// 期待値は docs/reference/scoring-algorithm.md「スコア範囲と評価」の表から決める。
// excellent 80〜100 / good 60〜79 / fair 40〜59 / poor 20〜39 / bad 0〜19。
// 守る状態: 各ランクの下限（80・60・40・20）のちょうどが上のランクに入り、1 下は下のランクに入る。
describe('getScoreRank', () => {
  it.each([
    ['T-RANK-01', 100, 'excellent'],
    ['T-RANK-01', 80, 'excellent'],
    ['T-RANK-02', 79, 'good'],
    ['T-RANK-02', 60, 'good'],
    ['T-RANK-03', 59, 'fair'],
    ['T-RANK-03', 40, 'fair'],
    ['T-RANK-04', 39, 'poor'],
    ['T-RANK-04', 20, 'poor'],
    ['T-RANK-05', 19, 'bad'],
    ['T-RANK-05', 0, 'bad'],
  ])('[%s] スコア %s のとき %s', (_id, score, rank) => {
    expect(getScoreRank(score)).toBe(rank);
  });
});
