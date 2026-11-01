import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SCORE_CARD_LABELS, TIME_CARD_LABELS } from '@/constants/labels';
import { formatTime } from '@/lib/utils/dashboardUtils';
import type { TimeScoreInfo } from '@/types/dashboard';

interface TimeScoreCardProps {
  timeScore: TimeScoreInfo;
}

export function TimeScoreCard({ timeScore }: TimeScoreCardProps) {
  const times = [
    [TIME_CARD_LABELS.CURRENT_TIME, timeScore.currentTime],
    [TIME_CARD_LABELS.SUNRISE, timeScore.sunrise],
    [TIME_CARD_LABELS.SUNSET, timeScore.sunset],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{TIME_CARD_LABELS.TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="font-mono text-metric tabular-nums">
          {Math.round(timeScore.score)}
          {SCORE_CARD_LABELS.TIME_MAX}
        </div>

        <dl className="grid grid-cols-3 gap-3">
          {times.map(([label, time]) => (
            <div key={label}>
              <dt className="text-label text-muted-foreground">{label}</dt>
              <dd className="font-mono text-data tabular-nums">{formatTime(time)}</dd>
            </div>
          ))}
        </dl>

        <div className="border-t pt-4">
          <div className="font-bold mb-2">{timeScore.timeCategory}</div>
          <p className="text-sm text-muted-foreground">{timeScore.explanation}</p>
        </div>
      </CardContent>
    </Card>
  );
}
