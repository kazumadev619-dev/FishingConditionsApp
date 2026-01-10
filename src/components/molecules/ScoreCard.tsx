'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScoreBadge } from '@/components/atoms/ScoreBadge';
import { getRankColor } from '@/lib/utils/dashboardUtils';
import type { FishingScore } from '@/types/scoring';
import { SCORE_CARD_LABELS } from '@/constants/labels';

interface ScoreCardProps {
  score: FishingScore;
  onDetailsClick?: () => void;
}

export function ScoreCard({ score, onDetailsClick }: ScoreCardProps) {
  return (
    <Card className="text-center">
      <CardHeader>
        <CardTitle>{SCORE_CARD_LABELS.TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-6xl font-bold mb-4" style={{ color: getRankColor(score.rank) }}>
          {Math.round(score.score)}
        </div>
        <ScoreBadge rank={score.rank} size="lg" />

        <div className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>{SCORE_CARD_LABELS.TIDE}</span>
            <span className="font-semibold">
              {Math.round(score.components.tide)}
              {SCORE_CARD_LABELS.TIDE_MAX}
            </span>
          </div>
          <div className="flex justify-between">
            <span>{SCORE_CARD_LABELS.WEATHER}</span>
            <span className="font-semibold">
              {Math.round(score.components.weather)}
              {SCORE_CARD_LABELS.WEATHER_MAX}
            </span>
          </div>
          <div className="flex justify-between">
            <span>{SCORE_CARD_LABELS.TIME}</span>
            <span className="font-semibold">
              {Math.round(score.components.time)}
              {SCORE_CARD_LABELS.TIME_MAX}
            </span>
          </div>
        </div>

        {onDetailsClick && (
          <button
            onClick={onDetailsClick}
            className="mt-6 w-full py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            {SCORE_CARD_LABELS.DETAILS_BUTTON}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
