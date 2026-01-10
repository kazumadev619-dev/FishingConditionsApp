'use client';

import { motion } from 'framer-motion';
import { ScoreCard } from '@/components/molecules/ScoreCard';
import { TideCard } from '@/components/molecules/TideCard';
import { WeatherCard } from '@/components/molecules/WeatherCard';
import { TimeScoreCard } from '@/components/molecules/TimeScoreCard';
import { FishingLocationMap } from '@/components/molecules/FishingLocationMap';
import { FavoriteButton } from '@/components/atoms/FavoriteButton';
import { useFavorites } from '@/hooks/useFavorites';
import type { DashboardData } from '@/types/dashboard';
import {
  cardVariants,
  hoverScaleTransition,
  headerAnimation,
  explanationAnimation,
  mapAnimation,
  cardHoverScale,
} from '@/constants/animations';
import { DASHBOARD_LABELS } from '@/constants/labels';

interface DashboardGridProps {
  data: DashboardData;
  location: {
    id?: string;
    name: string;
    latitude: number;
    longitude: number;
    prefectureCode: string;
    portCode: string;
    source?: {
      type: 'port' | 'coordinates';
      portId?: string;
      coordinates?: { lat: number; lng: number; name: string };
    };
  };
}

export function DashboardGrid({ data, location }: DashboardGridProps) {
  const { isFavorite, addFavorite, removeFavorite, isLoading } = useFavorites();

  const handleToggleFavorite = async () => {
    try {
      const locationId = location.id || '';
      if (isFavorite(locationId)) {
        await removeFavorite(locationId);
      } else {
        // locationIdがある場合はそれを使用、ない場合はsourceから作成
        if (location.id) {
          await addFavorite(location.id);
        } else if (location.source?.type === 'port' && location.source.portId) {
          await addFavorite(undefined, location.source.portId);
        } else if (location.source?.type === 'coordinates' && location.source.coordinates) {
          await addFavorite(
            undefined,
            undefined,
            location.source.coordinates.lat,
            location.source.coordinates.lng,
            location.source.coordinates.name,
          );
        }
      }
    } catch {
      // エラーはuseFavorites内でログ出力済み
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <motion.div
        className="mb-6"
        initial={headerAnimation.initial}
        animate={headerAnimation.animate}
        transition={headerAnimation.transition}
      >
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-3xl font-bold">
            {data.location.name} {DASHBOARD_LABELS.LOCATION_SUFFIX}
          </h1>
          <FavoriteButton
            isFavorite={isFavorite(location.id || '')}
            isLoading={isLoading}
            onToggle={handleToggleFavorite}
            size="lg"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {DASHBOARD_LABELS.LAST_UPDATED} {data.fishingScore.calculatedAt.toLocaleString('ja-JP')}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div
          className="md:col-span-2"
          custom={0}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
          whileHover={cardHoverScale}
          transition={hoverScaleTransition}
        >
          <ScoreCard score={data.fishingScore} />
        </motion.div>

        <motion.div
          custom={1}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
          whileHover={cardHoverScale}
          transition={hoverScaleTransition}
        >
          <TideCard score={data.fishingScore.components.tide} tide={data.todayTide} />
        </motion.div>

        <motion.div
          custom={2}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
          whileHover={cardHoverScale}
          transition={hoverScaleTransition}
        >
          <WeatherCard score={data.fishingScore.components.weather} weather={data.weatherData} />
        </motion.div>

        <motion.div
          className="md:col-span-2"
          custom={3}
          initial="hidden"
          animate="visible"
          variants={cardVariants}
          whileHover={cardHoverScale}
          transition={hoverScaleTransition}
        >
          <TimeScoreCard timeScore={data.timeScore} />
        </motion.div>
      </div>

      {data.fishingScore.explanation && (
        <motion.div
          className="mt-6 p-4 bg-card rounded-lg border"
          initial={explanationAnimation.initial}
          animate={explanationAnimation.animate}
          transition={explanationAnimation.transition}
        >
          <h3 className="font-semibold mb-2">{DASHBOARD_LABELS.SCORE_EXPLANATION_TITLE}</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {data.fishingScore.explanation}
          </p>
        </motion.div>
      )}

      <motion.div
        className="mt-6"
        initial={mapAnimation.initial}
        animate={mapAnimation.animate}
        transition={mapAnimation.transition}
      >
        <h2 className="text-xl font-semibold mb-4">{DASHBOARD_LABELS.LOCATION_MAP_TITLE}</h2>
        <div className="rounded-lg overflow-hidden border">
          <FishingLocationMap
            latitude={data.location.latitude}
            longitude={data.location.longitude}
            locationName={data.location.name}
          />
        </div>
      </motion.div>
    </div>
  );
}
