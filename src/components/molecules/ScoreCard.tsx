'use client';

import { Clock, Sun, Waves } from 'lucide-react';
import { ScoreBadge } from '@/components/atoms/ScoreBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SCORE_CARD_LABELS } from '@/constants/labels';
import { getRankColor } from '@/lib/utils/dashboardUtils';
import type { FishingScore } from '@/types/scoring';

interface ScoreCardProps {
  score: FishingScore;
  onDetailsClick?: () => void;
}

export function ScoreCard({ score, onDetailsClick }: ScoreCardProps) {
  const breakdown = [
    {
      Icon: Waves,
      label: SCORE_CARD_LABELS.TIDE,
      value: score.components.tide,
      max: SCORE_CARD_LABELS.TIDE_MAX,
    },
    {
      Icon: Sun,
      label: SCORE_CARD_LABELS.WEATHER,
      value: score.components.weather,
      max: SCORE_CARD_LABELS.WEATHER_MAX,
    },
    {
      Icon: Clock,
      label: SCORE_CARD_LABELS.TIME,
      value: score.components.time,
      max: SCORE_CARD_LABELS.TIME_MAX,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{SCORE_CARD_LABELS.TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <span
            className="font-mono text-score tabular-nums"
            style={{ color: getRankColor(score.rank) }}
          >
            {Math.round(score.score)}
          </span>
          <ScoreBadge rank={score.rank} />
        </div>

        <dl className="grid gap-2 rounded-md bg-muted p-3">
          {breakdown.map(({ Icon, label, value, max }) => (
            <div key={label} className="flex items-baseline justify-between">
              <dt className="inline-flex items-center gap-1 text-label">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </dt>
              <dd className="font-mono text-data tabular-nums">
                {Math.round(value)}
                <span className="text-muted-foreground">{max}</span>
              </dd>
            </div>
          ))}
        </dl>

        {onDetailsClick && (
          <Button type="button" onClick={onDetailsClick} className="w-full">
            {SCORE_CARD_LABELS.DETAILS_BUTTON}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
