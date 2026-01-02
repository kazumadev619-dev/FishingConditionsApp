import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { WeatherIcon } from '@/components/atoms/WeatherIcon';
import { formatTime, getWindDirection } from '@/lib/utils/dashboardUtils';
import type { FormattedWeatherData } from '@/lib/openWeatherService';
import { WEATHER_CARD_LABELS, SCORE_CARD_LABELS } from '@/constants/labels';

interface WeatherCardProps {
  score: number;
  weather: FormattedWeatherData;
}

export function WeatherCard({ score, weather }: WeatherCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{WEATHER_CARD_LABELS.TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="text-sm text-muted-foreground">{WEATHER_CARD_LABELS.SCORE}</span>
          <span className="ml-2 font-semibold">
            {Math.round(score)}
            {SCORE_CARD_LABELS.WEATHER_MAX}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WeatherIcon condition={weather.weather.main} size={32} />
            <span>{weather.weather.description}</span>
          </div>
          <span className="text-3xl font-bold">
            {Math.round(weather.temperature)}
            {WEATHER_CARD_LABELS.TEMPERATURE_UNIT}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            {WEATHER_CARD_LABELS.WIND_SPEED} {weather.windSpeed.toFixed(1)}{' '}
            {WEATHER_CARD_LABELS.WIND_SPEED_UNIT}
          </div>
          <div>
            {WEATHER_CARD_LABELS.WIND_DIRECTION} {getWindDirection(weather.windDeg)}
          </div>
          <div>
            {WEATHER_CARD_LABELS.HUMIDITY} {weather.humidity}
            {WEATHER_CARD_LABELS.HUMIDITY_UNIT}
          </div>
          <div>
            {WEATHER_CARD_LABELS.PRESSURE} {weather.pressure} {WEATHER_CARD_LABELS.PRESSURE_UNIT}
          </div>
          <div>
            {WEATHER_CARD_LABELS.CLOUDINESS} {weather.cloudiness}
            {WEATHER_CARD_LABELS.CLOUDINESS_UNIT}
          </div>
          <div>
            {WEATHER_CARD_LABELS.VISIBILITY} {(weather.visibility / 1000).toFixed(1)}{' '}
            {WEATHER_CARD_LABELS.VISIBILITY_UNIT}
          </div>
        </div>

        <div className="border-t pt-4 flex justify-between text-sm">
          <div>
            {WEATHER_CARD_LABELS.SUNRISE} {formatTime(weather.sunrise)}
          </div>
          <div>
            {WEATHER_CARD_LABELS.SUNSET} {formatTime(weather.sunset)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
