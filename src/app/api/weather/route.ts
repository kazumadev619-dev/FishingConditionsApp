/**
 * Weather API エンドポイント
 * GET /api/weather?lat={緯度}&lon={経度}
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentWeather, getForecast, isWeatherApiConfigured } from '@/lib/openWeatherService';
import { ApiError } from '@/lib/apiClient';
import { logApiError } from '@/lib/apiErrorUtils';
import { logger } from '@/lib/logger';

/**
 * 座標パラメータのバリデーション
 */
function validateCoordinates(
  lat: string | null,
  lon: string | null,
): { lat: number; lon: number } | { error: string } {
  if (!lat || !lon) {
    return { error: '緯度(lat)と経度(lon)は必須パラメータです' };
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  if (isNaN(latNum) || isNaN(lonNum)) {
    return { error: '緯度と経度は有効な数値である必要があります' };
  }

  if (latNum < -90 || latNum > 90) {
    return { error: '緯度は-90から90の範囲である必要があります' };
  }

  if (lonNum < -180 || lonNum > 180) {
    return { error: '経度は-180から180の範囲である必要があります' };
  }

  return { lat: latNum, lon: lonNum };
}

/**
 * GET /api/weather
 * クエリパラメータ:
 * - lat: 緯度（必須）
 * - lon: 経度（必須）
 * - type: 'current' | 'forecast'（デフォルト: 'current'）
 * - lang: 言語コード（デフォルト: 'ja'）
 * - units: 'standard' | 'metric' | 'imperial'（デフォルト: 'metric'）
 * - skipCache: キャッシュをスキップするか（デフォルト: false）
 */
export async function GET(request: NextRequest) {
  // APIキーのチェック
  if (!isWeatherApiConfigured()) {
    logger.error('OPENWEATHERMAP_API_KEY is not configured');
    return NextResponse.json(
      { error: 'Weather API is not configured', code: 'API_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  const searchParams = request.nextUrl.searchParams;

  // 座標パラメータの取得とバリデーション
  const coordResult = validateCoordinates(searchParams.get('lat'), searchParams.get('lon'));

  if ('error' in coordResult) {
    return NextResponse.json({ error: coordResult.error, code: 'INVALID_PARAMS' }, { status: 400 });
  }

  const { lat, lon } = coordResult;

  // オプションパラメータの取得
  const type = searchParams.get('type') || 'current';
  const lang = searchParams.get('lang') || 'ja';
  const units = (searchParams.get('units') as 'standard' | 'metric' | 'imperial') || 'metric';
  const skipCache = searchParams.get('skipCache') === 'true';

  // typeパラメータのバリデーション
  if (type !== 'current' && type !== 'forecast') {
    return NextResponse.json(
      { error: 'typeは "current" または "forecast" である必要があります', code: 'INVALID_PARAMS' },
      { status: 400 },
    );
  }

  // unitsパラメータのバリデーション
  if (!['standard', 'metric', 'imperial'].includes(units)) {
    return NextResponse.json(
      {
        error: 'unitsは "standard", "metric", または "imperial" である必要があります',
        code: 'INVALID_PARAMS',
      },
      { status: 400 },
    );
  }

  try {
    const options = { lang, units, skipCache };

    if (type === 'forecast') {
      const result = await getForecast(lat, lon, options);
      return NextResponse.json({
        success: true,
        type: 'forecast',
        ...result,
      });
    }

    const result = await getCurrentWeather(lat, lon, options);
    return NextResponse.json({
      success: true,
      type: 'current',
      ...result,
    });
  } catch (error) {
    // ApiErrorの場合は詳細なエラーレスポンスを返す
    if (error instanceof ApiError) {
      logApiError(error, { endpoint: '/api/weather', lat, lon, type });

      const statusCode = error.statusCode || 500;

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.type,
          retryable: error.retryable,
        },
        { status: statusCode >= 500 ? 502 : statusCode },
      );
    }

    // 予期しないエラー
    logger.error({ err: error }, 'Weather API unexpected error');

    return NextResponse.json(
      {
        success: false,
        error: '天気データの取得中にエラーが発生しました',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
