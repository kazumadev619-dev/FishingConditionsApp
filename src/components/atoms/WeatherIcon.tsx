import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  type LucideIcon,
  Snowflake,
  Sun,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Clear: Sun,
  Sunny: Sun,
  晴れ: Sun,
  'Partly Cloudy': CloudSun,
  Cloudy: Cloud,
  Clouds: Cloud,
  曇り: Cloud,
  'Light Rain': CloudDrizzle,
  Drizzle: CloudDrizzle,
  小雨: CloudDrizzle,
  Rain: CloudRain,
  雨: CloudRain,
  'Heavy Rain': CloudLightning,
  Thunderstorm: CloudLightning,
  嵐: CloudLightning,
  Snow: Snowflake,
  雪: Snowflake,
  Mist: CloudFog,
  Fog: CloudFog,
};

interface WeatherIconProps {
  condition: string;
  size?: number;
}

export function WeatherIcon({ condition, size = 24 }: WeatherIconProps) {
  const Icon = ICONS[condition] ?? Cloud;

  return <Icon size={size} role="img" aria-label={condition} className="text-primary" />;
}
