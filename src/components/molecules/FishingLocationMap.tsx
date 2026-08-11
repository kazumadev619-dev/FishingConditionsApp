'use client';

import { AdvancedMarker, APIProvider, Map as GoogleMap } from '@vis.gl/react-google-maps';
import { logger } from '@/lib/logger';

interface FishingLocationMapProps {
  latitude: number;
  longitude: number;
  locationName: string;
  height?: string;
}

// Next.jsの環境変数からAPIキーとMap IDを取得
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || '';

export function FishingLocationMap({
  latitude,
  longitude,
  locationName,
  height = '400px', // heightをpropsから受け取る
}: FishingLocationMapProps) {
  const center = { lat: latitude, lng: longitude };

  const mapOptions = {
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  };

  const mapContainerStyle = {
    width: '100%',
    height,
  };

  // APIキーとMap IDがない場合はマップを表示しない
  if (!GOOGLE_MAPS_API_KEY || !GOOGLE_MAPS_MAP_ID) {
    logger.error('Google Maps API Key or Map ID is not set.');
    return (
      <div className="flex items-center justify-center h-[400px] bg-muted rounded-lg">
        <p className="text-destructive">
          マップの読み込みエラー: APIキーまたはMap IDが設定されていません。
        </p>
      </div>
    );
  }

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} solutionChannel="maps-sdk-react-components">
      <GoogleMap
        mapId={GOOGLE_MAPS_MAP_ID}
        style={mapContainerStyle}
        center={center}
        zoom={14}
        gestureHandling={'greedy'}
        disableDefaultUI={!mapOptions.disableDefaultUI}
        zoomControl={mapOptions.zoomControl}
        mapTypeControl={mapOptions.mapTypeControl}
        streetViewControl={mapOptions.streetViewControl}
        fullscreenControl={mapOptions.fullscreenControl}
      >
        <AdvancedMarker position={center} title={locationName} />
      </GoogleMap>
    </APIProvider>
  );
}
