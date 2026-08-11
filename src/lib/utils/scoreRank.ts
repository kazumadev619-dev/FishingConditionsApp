import type { ScoreRank } from '@/types/scoring';

export function getScoreRank(score: number): ScoreRank {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'bad';
}
