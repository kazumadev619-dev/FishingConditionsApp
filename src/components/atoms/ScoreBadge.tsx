import { getRankColor, getRankLabel } from '@/lib/utils/dashboardUtils';
import type { ScoreRank } from '@/types/scoring';

interface ScoreBadgeProps {
  rank: ScoreRank;
  size?: 'sm' | 'md';
}

export function ScoreBadge({ rank, size = 'md' }: ScoreBadgeProps) {
  const color = getRankColor(rank);
  const label = getRankLabel(rank);

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-bold ${sizeClasses[size]}`}
      style={{ backgroundColor: color, color: 'var(--score-foreground)' }}
      role="status"
      aria-label={`スコアランク: ${label}`}
    >
      {label}
    </span>
  );
}
