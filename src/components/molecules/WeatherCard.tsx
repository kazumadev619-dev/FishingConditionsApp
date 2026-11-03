import { WeatherIcon } from '@/components/atoms/WeatherIcon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SCORE_CARD_LABELS, WEATHER_CARD_LABELS } from '@/constants/labels';
import type { FormattedWeatherData } from '@/lib/openWeatherService';
import { formatTime, getWindDirection } from '@/lib/utils/dashboardUtils';

interface WeatherCardProps {
  score: number;
  weather: FormattedWeatherData;
}

export function WeatherCard({ score, weather }: WeatherCardProps) {
  const details = [
    [
      WEATHER_CARD_LABELS.WIND_SPEED,
      `${weather.windSpeed.toFixed(1)} ${WEATHER_CARD_LABELS.WIND_SPEED_UNIT}`,
    ],
    [WEATHER_CARD_LABELS.WIND_DIRECTION, getWindDirection(weather.windDeg)],
    [WEATHER_CARD_LABELS.HUMIDITY, `${weather.humidity} ${WEATHER_CARD_LABELS.HUMIDITY_UNIT}`],
    [WEATHER_CARD_LABELS.PRESSURE, `${weather.pressure} ${WEATHER_CARD_LABELS.PRESSURE_UNIT}`],
    [
      WEATHER_CARD_LABELS.CLOUDINESS,
      `${weather.cloudiness} ${WEATHER_CARD_LABELS.CLOUDINESS_UNIT}`,
    ],
    [
      WEATHER_CARD_LABELS.VISIBILITY,
      `${(weather.visibility / 1000).toFixed(1)} ${WEATHER_CARD_LABELS.VISIBILITY_UNIT}`,
    ],
    [WEATHER_CARD_LABELS.SUNRISE, formatTime(weather.sunrise)],
    [WEATHER_CARD_LABELS.SUNSET, formatTime(weather.sunset)],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{WEATHER_CARD_LABELS.TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-sm text-muted-foreground">{WEATHER_CARD_LABELS.SCORE}</span>
          <span className="ml-2 font-mono text-data tabular-nums">
            {Math.round(score)}
            {SCORE_CARD_LABELS.WEATHER_MAX}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WeatherIcon condition={weather.weather.main} size={32} />
            <span>{weather.weather.description}</span>
          </div>
          <span className="font-mono text-metric tabular-nums">
            {Math.round(weather.temperature)} {WEATHER_CARD_LABELS.TEMPERATURE_UNIT}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 border-t pt-4">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-label text-muted-foreground">{label}</dt>
              <dd className="font-mono text-data tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
