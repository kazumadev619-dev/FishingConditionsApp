/**
 * GET /api/locations/search
 * 場所検索エンドポイント
 *
 * クエリパラメータ:
 * - q: 検索クエリ（例: "東京", "築地市場"）
 * - limit: 結果の上限数（デフォルト: 10）
 * - skipCache: キャッシュをスキップするか（true|false）
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/apiResponseHandler';
import { isLocationSearchConfigured, searchLocations } from '@/lib/locationService';
import { logger } from '@/lib/logger';

/**
 * 検索クエリのバリデーション関数
 */
function isValidQuery(query: string): boolean {
  // 制御文字をチェック
  for (const char of query) {
    const code = char.charCodeAt(0);
    // 制御文字（0x00-0x1f, 0x7f）を除外
    if ((code >= 0 && code <= 31) || code === 127) {
      return false;
    }
  }
  return true;
}

const LIMIT_REGEX = /^\d+$/;

/**
 * GET ハンドラ
 */
export async function GET(request: NextRequest) {
  try {
    // Google Maps API が設定されているか確認
    if (!isLocationSearchConfigured()) {
      return createErrorResponse(
        'Location search is not configured. Please set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.',
        503,
      );
    }

    // クエリパラメータを抽出
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const limitParam = searchParams.get('limit') || '10';
    const skipCache = searchParams.get('skipCache') === 'true';

    // バリデーション: q パラメータが必須
    if (!query) {
      return createErrorResponse('Missing required parameter: q', 400);
    }

    // バリデーション: q の長さと内容
    if (query.length < 2) {
      return createErrorResponse('Search query must be at least 2 characters', 400);
    }

    if (query.length > 200) {
      return createErrorResponse('Search query must be less than 200 characters', 400);
    }

    if (!isValidQuery(query)) {
      return createErrorResponse('Search query contains invalid characters', 400);
    }

    // バリデーション: limit
    if (!LIMIT_REGEX.test(limitParam)) {
      return createErrorResponse('Invalid limit parameter. Must be a positive number.', 400);
    }

    const limit = Math.min(parseInt(limitParam, 10), 50); // 最大50件まで
    if (limit < 1) {
      return createErrorResponse('Limit must be at least 1', 400);
    }

    // 場所検索を実行
    const response = await searchLocations(query, {
      skipCache,
      limit,
    });

    // レスポンスを返す
    return NextResponse.json(
      {
        status: 200,
        data: response.data,
        meta: {
          query: response.query,
          count: response.data.length,
          fromCache: response.fromCache,
          fetchedAt: response.fetchedAt,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': response.fromCache
            ? 'public, max-age=3600' // キャッシュから取得した場合は 1 時間キャッシュ
            : 'public, max-age=300', // 新規取得の場合は 5 分キャッシュ
        },
      },
    );
  } catch (error) {
    // エラーハンドリング
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error({ err: error }, 'Location search API error');

    return NextResponse.json(
      {
        error: errorMessage,
        status: 500,
      },
      { status: 500 },
    );
  }
}
