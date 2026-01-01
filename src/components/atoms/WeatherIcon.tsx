interface WeatherIconProps {
  condition: string;
  size?: number;
}

export function WeatherIcon({ condition, size = 24 }: WeatherIconProps) {
  const icons: Record<string, string> = {
    Clear: '☀️',
    Sunny: '☀️',
    晴れ: '☀️',
    'Partly Cloudy': '⛅',
    Cloudy: '☁️',
    Clouds: '☁️',
    曇り: '☁️',
    'Light Rain': '🌦️',
    Drizzle: '🌦️',
    小雨: '🌦️',
    Rain: '🌧️',
    雨: '🌧️',
    'Heavy Rain': '⛈️',
    Thunderstorm: '⛈️',
    嵐: '⛈️',
    Snow: '❄️',
    雪: '❄️',
    Mist: '🌫️',
    Fog: '🌫️',
  };

  const icon = icons[condition] || '☁️';

  return (
    <span style={{ fontSize: size }} role="img" aria-label={condition} className="inline-block">
      {icon}
    </span>
  );
}
