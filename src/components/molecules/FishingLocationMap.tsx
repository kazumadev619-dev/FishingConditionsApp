'use client';

import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';

interface FishingLocationMapProps {
  latitude: number;
  longitude: number;
  locationName: string;
  height?: string;
}

const customMapContainerStyle = {
  width: '100%',
  height: '400px', // デフォルト値
};

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

  const currentMapContainerStyle = {
    ...customMapContainerStyle,
    height,
  };

  // APIキーとMap IDがない場合はマップを表示しない
  if (!GOOGLE_MAPS_API_KEY || !GOOGLE_MAPS_MAP_ID) {
    console.error('Google Maps API Key or Map ID is not set.');
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
      <Map
        mapId={GOOGLE_MAPS_MAP_ID}
        style={currentMapContainerStyle}
        defaultCenter={center}
        defaultZoom={14}
        gestureHandling={'greedy'}
        disableDefaultUI={!mapOptions.disableDefaultUI}
        zoomControl={mapOptions.zoomControl}
        mapTypeControl={mapOptions.mapTypeControl}
        streetViewControl={mapOptions.streetViewControl}
        fullscreenControl={mapOptions.fullscreenControl}
      >
        <AdvancedMarker position={center} title={locationName} />
      </Map>
    </APIProvider>
  );
}
