import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SCORE_CARD_LABELS, TIDE_CARD_LABELS } from '@/constants/labels';
import type { DailyTide, TideEvent } from '@/lib/tideService';
import { formatTideEvent } from '@/lib/utils/dashboardUtils';

interface TideCardProps {
  score: number;
  tide: DailyTide;
}

function TideEvents({ title, events }: { title: string; events: TideEvent[] }) {
  return (
    <div>
      <h4 className="text-label text-muted-foreground mb-1">{title}</h4>
      {events.map((event: TideEvent, index: number) => {
        const { time, height } = formatTideEvent(event.time, event.cm);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: tide events have no stable unique id
          <div key={index} className="flex items-baseline gap-2 tabular-nums">
            <span className="font-mono text-metric">{time}</span>
            <span className="font-mono text-data text-muted-foreground">{height}</span>
          </div>
        );
      })}
    </div>
  );
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
          <span className="ml-2 font-mono text-data tabular-nums">
            {Math.round(score)}
            {SCORE_CARD_LABELS.TIDE_MAX}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TideEvents title={TIDE_CARD_LABELS.HIGH_TIDE} events={tide.flood} />
          <TideEvents title={TIDE_CARD_LABELS.LOW_TIDE} events={tide.edd} />
        </div>

        <div className="border-t pt-4">
          <div className="text-sm">
            <span className="text-muted-foreground">{TIDE_CARD_LABELS.TIDE_TYPE}</span>
            <span className="ml-2 font-bold">{tide.moon.title}</span>
          </div>
          <div className="text-sm mt-1">
            <span className="text-muted-foreground">{TIDE_CARD_LABELS.MOON_AGE}</span>
            <span className="ml-2 font-mono text-data tabular-nums">
              {parseFloat(tide.moon.age).toFixed(1)}
              {TIDE_CARD_LABELS.MOON_AGE_UNIT}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
