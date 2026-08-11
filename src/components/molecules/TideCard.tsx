import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SCORE_CARD_LABELS, TIDE_CARD_LABELS } from '@/constants/labels';
import type { DailyTide, TideEvent } from '@/lib/tideService';
import { formatTideEvent } from '@/lib/utils/dashboardUtils';

interface TideCardProps {
  score: number;
  tide: DailyTide;
}

export function TideCard({ score, tide }: TideCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{TIDE_CARD_LABELS.TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-sm text-muted-foreground">{TIDE_CARD_LABELS.SCORE}</span>
          <span className="ml-2 font-semibold">
            {Math.round(score)}
            {SCORE_CARD_LABELS.TIDE_MAX}
          </span>
        </div>

        <div>
          <h4 className="font-semibold mb-2">{TIDE_CARD_LABELS.HIGH_TIDE}</h4>
          {tide.flood.map((high: TideEvent, index: number) => {
            const { time, height } = formatTideEvent(high.time, high.cm);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: tide events have no stable unique id
              <div key={index} className="text-sm pl-4">
                ├─ {time} ({height})
              </div>
            );
          })}
        </div>

        <div>
          <h4 className="font-semibold mb-2">{TIDE_CARD_LABELS.LOW_TIDE}</h4>
          {tide.edd.map((low: TideEvent, index: number) => {
            const { time, height } = formatTideEvent(low.time, low.cm);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: tide events have no stable unique id
              <div key={index} className="text-sm pl-4">
                ├─ {time} ({height})
              </div>
            );
          })}
        </div>

        <div className="border-t pt-4">
          <div className="text-sm">
            <span className="text-muted-foreground">{TIDE_CARD_LABELS.TIDE_TYPE}</span>
            <span className="ml-2 font-semibold">{tide.moon.title}</span>
          </div>
          <div className="text-sm mt-1">
            <span className="text-muted-foreground">{TIDE_CARD_LABELS.MOON_AGE}</span>
            <span className="ml-2">
              {parseFloat(tide.moon.age).toFixed(1)}
              {TIDE_CARD_LABELS.MOON_AGE_UNIT}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
