import { getRankColor, getRankLabel } from '@/lib/utils/dashboardUtils';
import type { ScoreRank } from '@/types/scoring';

interface ScoreBadgeProps {
  rank: ScoreRank;
  size?: 'sm' | 'md' | 'lg';
}

export function ScoreBadge({ rank, size = 'md' }: ScoreBadgeProps) {
  const color = getRankColor(rank);
  const label = getRankLabel(rank);

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${sizeClasses[size]}`}
      style={{ backgroundColor: color, color: 'white' }}
      role="status"
      aria-label={`スコアランク: ${label}`}
    >
      {label}
    </span>
  );
}
