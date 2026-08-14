/**
 * 釣りやすさスコア計算API
 * GET /api/scores?lat=35.6762&lon=139.6503&prefectureCode=13&portCode=12345&date=2025-12-24
 */

import { type NextRequest, NextResponse } from 'next/server';
import { CACHE_PREFIX, CACHE_TTL, generateCacheKey, withCache } from '@/lib/cache';
import { logger } from '@/lib/logger';
import { getCurrentWeather } from '@/lib/openWeatherService';
import { calculateFishingScore } from '@/lib/scoringService';
import { withServerTiming } from '@/lib/serverTiming';
import { getTideData } from '@/lib/tideService';
import type { ScoringResponse } from '@/types/scoring';

/**
 * スコア計算API
 */
export async function GET(
  request: NextRequest,
): Promise<NextResponse<ScoringResponse | { error: string }>> {
  return withServerTiming('scores', () => handleGet(request));
}

async function handleGet(
  request: NextRequest,
): Promise<NextResponse<ScoringResponse | { error: string }>> {
  try {
    // クエリパラメータを取得
    const searchParams = request.nextUrl.searchParams;
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const prefectureCode = searchParams.get('prefectureCode');
    const portCode = searchParams.get('portCode');
    const dateStr = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const skipCache = searchParams.get('skipCache') === 'true';

    // バリデーション
    if (!lat || !lon) {
      return NextResponse.json({ error: 'Missing required parameters: lat, lon' }, { status: 400 });
    }

    if (!prefectureCode || !portCode) {
      return NextResponse.json(
        { error: 'Missing required parameters: prefectureCode, portCode' },
        { status: 400 },
      );
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return NextResponse.json(
        { error: 'Invalid coordinates: lat and lon must be numbers' },
        { status: 400 },
      );
    }

    // キャッシュキーを生成
    const cacheKey = generateCacheKey(CACHE_PREFIX.WEATHER, {
      lat: latitude,
      lon: longitude,
      prefecture: prefectureCode,
      port: portCode,
      date: dateStr,
    });

    // キャッシュを使用してスコアを計算
    if (!skipCache) {
      const cachedResult = await withCache<ScoringResponse>(
        cacheKey,
        CACHE_TTL.WEATHER, // 天気と同じ30分キャッシュ
        async () => {
          return await computeScore(latitude, longitude, prefectureCode, portCode, dateStr);
        },
      );

      return NextResponse.json(cachedResult.data, {
        headers: {
          'X-From-Cache': cachedResult.fromCache ? 'true' : 'false',
          'Cache-Control': 'public, max-age=1800', // 30分
        },
      });
    }

    // キャッシュをスキップして直接計算
    const result = await computeScore(latitude, longitude, prefectureCode, portCode, dateStr);

    return NextResponse.json(result, {
      headers: {
        'X-From-Cache': 'false',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Scores API error');

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { error: `Failed to calculate fishing score: ${errorMessage}` },
      { status: 500 },
    );
  }
}

/**
 * スコアを計算するヘルパー関数
 */
async function computeScore(
  latitude: number,
  longitude: number,
  prefectureCode: string,
  portCode: string,
  dateStr: string,
): Promise<ScoringResponse> {
  // 天気データを取得
  const weatherResponse = await getCurrentWeather(latitude, longitude, {
    skipCache: false,
  });

  // 潮汐データを取得
  const tideResponse = await getTideData(prefectureCode, portCode, dateStr, {
    skipCache: false,
  });

  // スコアを計算
  const fishingScore = calculateFishingScore(
    tideResponse.data,
    weatherResponse.data,
    new Date(dateStr),
  );

  return {
    score: fishingScore,
    fromCache: weatherResponse.fromCache && tideResponse.fromCache,
  };
}
