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

import { NextRequest, NextResponse } from 'next/server';
import { getTideData } from '@/lib/tideService';

/**
 * バリデーション用の正規表現
 */
const PREFECTURE_CODE_REGEX = /^[0-9]{1,2}$/;
const PORT_CODE_REGEX = /^[a-zA-Z0-9]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 今日の日付を YYYY-MM-DD 形式で取得
 */
function getTodayDateString(): string {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

/**
 * GET ハンドラ
 */
export async function GET(request: NextRequest) {
  try {
    // クエリパラメータを抽出
    const searchParams = request.nextUrl.searchParams;
    const prefectureCode = searchParams.get('prefectureCode');
    const portCode = searchParams.get('portCode');
    const date = searchParams.get('date') || getTodayDateString();
    const range = (searchParams.get('range') as 'day' | 'week' | 'month') || 'week';
    const skipCache = searchParams.get('skipCache') === 'true';

    // バリデーション
    if (!prefectureCode) {
      return NextResponse.json(
        {
          error: 'Missing required parameter: prefectureCode',
          status: 400,
        },
        { status: 400 },
      );
    }

    if (!portCode) {
      return NextResponse.json(
        {
          error: 'Missing required parameter: portCode',
          status: 400,
        },
        { status: 400 },
      );
    }

    if (!PREFECTURE_CODE_REGEX.test(prefectureCode)) {
      return NextResponse.json(
        {
          error: 'Invalid prefectureCode format',
          status: 400,
        },
        { status: 400 },
      );
    }

    if (!PORT_CODE_REGEX.test(portCode)) {
      return NextResponse.json(
        {
          error: 'Invalid portCode format',
          status: 400,
        },
        { status: 400 },
      );
    }

    if (!DATE_REGEX.test(date)) {
      return NextResponse.json(
        {
          error: 'Invalid date format. Use YYYY-MM-DD',
          status: 400,
        },
        { status: 400 },
      );
    }

    if (!['day', 'week', 'month'].includes(range)) {
      return NextResponse.json(
        {
          error: 'Invalid range. Must be one of: day, week, month',
          status: 400,
        },
        { status: 400 },
      );
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

    console.error('[API] GET /api/conditions/tide error:', error);

    return NextResponse.json(
      {
        error: errorMessage,
        status: 500,
      },
      { status: 500 },
    );
  }
}
