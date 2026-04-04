/**
 * Weather API エンドポイント
 * GET /api/weather?lat={緯度}&lon={経度}
 */

import { type NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/apiClient';
import { logApiError } from '@/lib/apiErrorUtils';
import { createErrorResponse } from '@/lib/apiResponseHandler';
import { logger } from '@/lib/logger';
import { getCurrentWeather, getForecast, isWeatherApiConfigured } from '@/lib/openWeatherService';
import { parseAndValidateCoordinates } from '@/lib/validators';

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
    return createErrorResponse('Weather API is not configured', 503, 'API_NOT_CONFIGURED');
  }

  const searchParams = request.nextUrl.searchParams;

  // 座標パラメータの取得とバリデーション
  const coordResult = parseAndValidateCoordinates(searchParams.get('lat'), searchParams.get('lon'));

  if ('error' in coordResult) {
    return createErrorResponse(coordResult.error, 400, 'INVALID_PARAMS');
  }

  const { lat, lon } = coordResult;

  // オプションパラメータの取得
  const type = searchParams.get('type') || 'current';
  const lang = searchParams.get('lang') || 'ja';
  const units = (searchParams.get('units') as 'standard' | 'metric' | 'imperial') || 'metric';
  const skipCache = searchParams.get('skipCache') === 'true';

  // typeパラメータのバリデーション
  if (type !== 'current' && type !== 'forecast') {
    return createErrorResponse(
      'typeは "current" または "forecast" である必要があります',
      400,
      'INVALID_PARAMS',
    );
  }

  // unitsパラメータのバリデーション
  if (!['standard', 'metric', 'imperial'].includes(units)) {
    return createErrorResponse(
      'unitsは "standard", "metric", または "imperial" である必要があります',
      400,
      'INVALID_PARAMS',
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
