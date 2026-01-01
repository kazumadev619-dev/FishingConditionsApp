import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatTime } from '@/lib/utils/dashboardUtils';
import type { TimeScoreInfo } from '@/types/dashboard';
import { TIME_CARD_LABELS, SCORE_CARD_LABELS } from '@/constants/labels';

interface TimeScoreCardProps {
  timeScore: TimeScoreInfo;
}

export function TimeScoreCard({ timeScore }: TimeScoreCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{TIME_CARD_LABELS.TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-3xl font-bold">
            {Math.round(timeScore.score)}
            {SCORE_CARD_LABELS.TIME_MAX}
          </span>
        </div>

        <div className="space-y-2 text-sm">
          <div>
            {TIME_CARD_LABELS.CURRENT_TIME} {formatTime(timeScore.currentTime)}
          </div>
          <div>
            {TIME_CARD_LABELS.SUNRISE} {formatTime(timeScore.sunrise)}
          </div>
          <div>
            {TIME_CARD_LABELS.SUNSET} {formatTime(timeScore.sunset)}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="font-semibold mb-2">
            {TIME_CARD_LABELS.CATEGORY_PREFIX} {timeScore.timeCategory}
          </div>
          <p className="text-sm text-muted-foreground">{timeScore.explanation}</p>
        </div>
      </CardContent>
    </Card>
  );
}
