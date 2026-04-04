/**
 * GET /api/conditions/tide
 * 潮汐データ取得エンドポイント
 *
 * クエリパラメータ:
 * - prefectureCode: 都道府県コード（例: "13"）
 * - portCode: 港コード（例: "tk"）
 * - date: 取得日付（YYYY-MM-DD形式、デフォルト: 今日）
 * - range: 取得範囲（day|week|month、デフォルト: week）
 * - skipCache: キャッシュをスキップするか（true|false）
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/apiResponseHandler';
import { logger } from '@/lib/logger';
import { getTideData } from '@/lib/tideService';

/**
 * GET ハンドラ
 */
export async function GET(request: NextRequest) {
  try {
    // クエリパラメータを抽出
    const searchParams = request.nextUrl.searchParams;
    const prefectureCode = searchParams.get('prefectureCode');
    const portCode = searchParams.get('portCode');
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const range = (searchParams.get('range') as 'day' | 'week' | 'month') || 'week';
    const skipCache = searchParams.get('skipCache') === 'true';

    // バリデーション
    if (!prefectureCode) {
      return createErrorResponse('Missing required parameter: prefectureCode', 400);
    }

    if (!portCode) {
      return createErrorResponse('Missing required parameter: portCode', 400);
    }

    if (!/^[0-9]{1,2}$/.test(prefectureCode)) {
      return createErrorResponse('Invalid prefectureCode format', 400);
    }

    if (!/^[a-zA-Z0-9]+$/.test(portCode)) {
      return createErrorResponse('Invalid portCode format', 400);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return createErrorResponse('Invalid date format. Use YYYY-MM-DD', 400);
    }

    if (!['day', 'week', 'month'].includes(range)) {
      return createErrorResponse('Invalid range. Must be one of: day, week, month', 400);
    }

    // 潮汐データを取得
    const response = await getTideData(prefectureCode, portCode, date, {
      skipCache,
      range,
    });

    // レスポンスを返す
    return NextResponse.json(
      {
        status: 200,
        data: response.data,
        meta: {
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

    logger.error({ err: error }, 'Tide API error');

    return NextResponse.json(
      {
        error: errorMessage,
        status: 500,
      },
      { status: 500 },
    );
  }
}
