import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// リクエストボディのスキーマ定義
const SearchHistoryCreateSchema = z.object({
  locationId: z.string().uuid(),
});

/**
 * POST /api/user/search-history
 * 検索履歴を記録（認証必須）
 *
 * 同一location_idの履歴がある場合は、searched_atを最新のタイムスタンプに更新
 */
export async function POST(request: NextRequest) {
  try {
    // セッションチェック
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to save search history.' },
        { status: 401 },
      );
    }

    const userId = session.user.id;

    // リクエストボディのパース
    const body = await request.json();
    const validationResult = SearchHistoryCreateSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.issues,
        },
        { status: 400 },
      );
    }

    const { locationId } = validationResult.data;

    // location_idが存在するか確認
    const location = await prisma.locations.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    // 重複制御: 同一location_idの履歴が存在する場合は更新、なければ作成
    const existingHistory = await prisma.user_search_history.findFirst({
      where: {
        user_id: userId,
        location_id: locationId,
      },
    });

    if (existingHistory) {
      // 既存履歴のタイムスタンプを更新
      const updated = await prisma.user_search_history.update({
        where: { id: existingHistory.id },
        data: {
          searched_at: new Date(),
        },
      });

      logger.info(
        {
          userId,
          locationId,
          historyId: updated.id,
        },
        'Search history updated (duplicate control)',
      );

      return NextResponse.json({
        id: updated.id,
        user_id: updated.user_id,
        location_id: updated.location_id,
        searched_at: updated.searched_at,
        message: 'Search history updated',
      });
    }

    // 新規履歴作成
    const newHistory = await prisma.user_search_history.create({
      data: {
        user_id: userId,
        location_id: locationId,
      },
    });

    logger.info(
      {
        userId,
        locationId,
        historyId: newHistory.id,
      },
      'Search history saved successfully',
    );

    return NextResponse.json({
      id: newHistory.id,
      user_id: newHistory.user_id,
      location_id: newHistory.location_id,
      searched_at: newHistory.searched_at,
      message: 'Search history saved',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: error }, 'Search history save API error');

    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/user/search-history?limit=10
 * 検索履歴を取得（認証必須）
 *
 * 最新10件を取得（searched_at DESC）
 */
export async function GET(request: NextRequest) {
  try {
    // セッションチェック
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to view search history.' },
        { status: 401 },
      );
    }

    const userId = session.user.id;

    // URLパラメータからlimitを取得（デフォルト: 10）
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 10;

    // limitのバリデーション（1-100の範囲）
    if (limit < 1 || limit > 100) {
      return NextResponse.json({ error: 'Limit must be between 1 and 100' }, { status: 400 });
    }

    // 検索履歴を取得（locations + portsと結合）
    const searchHistory = await prisma.user_search_history.findMany({
      where: {
        user_id: userId,
      },
      orderBy: {
        searched_at: 'desc',
      },
      take: limit,
      include: {
        location: {
          include: {
            port: true,
          },
        },
      },
    });

    logger.info(
      {
        userId,
        count: searchHistory.length,
        limit,
      },
      'Search history fetched successfully',
    );

    return NextResponse.json({
      history: searchHistory.map((h) => ({
        id: h.id,
        searched_at: h.searched_at,
        location: {
          id: h.location.id,
          name: h.location.name,
          latitude: h.location.latitude,
          longitude: h.location.longitude,
          prefecture: h.location.prefecture,
          region: h.location.region,
          port: h.location.port
            ? {
                id: h.location.port.id,
                name: h.location.port.name,
                prefecture_code: h.location.port.prefecture_code,
              }
            : null,
        },
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: error }, 'Search history fetch API error');

    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
