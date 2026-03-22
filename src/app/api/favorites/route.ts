/**
 * お気に入り管理API
 * POST /api/favorites - お気に入り追加
 * DELETE /api/favorites?locationId=xxx - お気に入り削除
 * GET /api/favorites - お気に入り一覧取得
 */

import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { isValidUUID } from '@/lib/validators';
import type {
  FavoriteAddResponse,
  FavoriteLocation,
  FavoriteRequest,
  FavoritesResponse,
} from '@/types/favorites';

/**
 * 座標を小数点4桁に丸める（約11m精度）
 */
function roundCoordinate(coord: number): number {
  return Math.round(coord * 10000) / 10000;
}

/**
 * お気に入り一覧取得
 */
export async function GET(): Promise<NextResponse<FavoritesResponse | { error: string }>> {
  try {
    // セッションからユーザーIDを取得（ログイン前提のアプリなので認証チェックは省略）
    const session = await auth();
    const userId = session?.user?.id;

    // UUID形式の検証（無効なセッションの場合はエラー）
    if (!isValidUUID(userId)) {
      logger.error({ userId }, 'GET favorites: Invalid user ID in session');
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // お気に入り一覧を取得（location情報を含む）
    const favorites = await prisma.user_favorites.findMany({
      where: {
        user_id: userId,
      },
      include: {
        location: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // レスポンス形式に整形
    const favoriteLocations: FavoriteLocation[] = favorites.map((fav) => ({
      id: fav.id,
      locationId: fav.location_id,
      name: fav.location.name,
      latitude: fav.location.latitude,
      longitude: fav.location.longitude,
      region: fav.location.region,
      prefecture: fav.location.prefecture,
      createdAt: fav.created_at.toISOString(),
    }));

    return NextResponse.json({
      favorites: favoriteLocations,
      count: favoriteLocations.length,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch favorites');

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to fetch favorites: ${errorMessage}` },
      { status: 500 },
    );
  }
}

/**
 * お気に入り追加
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<FavoriteAddResponse | { error: string }>> {
  try {
    // セッションからユーザーIDを取得（ログイン前提のアプリなので認証チェックは省略）
    const session = await auth();
    const userId = session?.user?.id;

    // UUID形式の検証（無効なセッションの場合はエラー）
    if (!isValidUUID(userId)) {
      logger.error({ userId }, 'POST favorites: Invalid user ID in session');
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // リクエストボディを取得
    const body: FavoriteRequest = await request.json();
    const { locationId, portId, coordinates } = body;

    // いずれか1つは必須
    if (!locationId && !portId && !coordinates) {
      return NextResponse.json(
        { error: 'locationId, portId, or coordinates is required' },
        { status: 400 },
      );
    }

    let finalLocationId: string;

    // パターン1: 既存のlocationIdを使用
    if (locationId) {
      finalLocationId = locationId;
    }
    // パターン2: portIdからlocationを作成
    else if (portId) {
      // portsテーブルから情報を取得
      const port = await prisma.ports.findUnique({
        where: { id: portId },
      });

      if (!port) {
        return NextResponse.json({ error: 'Port not found' }, { status: 404 });
      }

      if (!port.latitude || !port.longitude) {
        return NextResponse.json({ error: 'Port has no coordinates' }, { status: 400 });
      }

      // 座標を丸める
      const roundedLat = roundCoordinate(port.latitude);
      const roundedLng = roundCoordinate(port.longitude);

      // 既存のlocationを検索（座標が一致するもの）
      const existingLocation = await prisma.locations.findFirst({
        where: {
          latitude: roundedLat,
          longitude: roundedLng,
        },
      });

      if (existingLocation) {
        finalLocationId = existingLocation.id;
      } else {
        // 新規作成
        const newLocation = await prisma.locations.create({
          data: {
            name: port.name,
            latitude: roundedLat,
            longitude: roundedLng,
            region: null,
            prefecture: null,
            port_id: portId,
          },
        });
        finalLocationId = newLocation.id;
      }
    }
    // パターン3: 座標からlocationを作成
    else if (coordinates) {
      const { lat, lng, name } = coordinates;

      // バリデーション
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
      }

      // 座標を丸める
      const roundedLat = roundCoordinate(lat);
      const roundedLng = roundCoordinate(lng);

      // 既存のlocationを検索（座標が一致するもの）
      const existingLocation = await prisma.locations.findFirst({
        where: {
          latitude: roundedLat,
          longitude: roundedLng,
        },
      });

      if (existingLocation) {
        finalLocationId = existingLocation.id;
      } else {
        // 新規作成
        const newLocation = await prisma.locations.create({
          data: {
            name,
            latitude: roundedLat,
            longitude: roundedLng,
            region: null,
            prefecture: null,
            port_id: null,
          },
        });
        finalLocationId = newLocation.id;
      }
    } else {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // お気に入りを追加
    await prisma.user_favorites.create({
      data: {
        user_id: userId,
        location_id: finalLocationId,
      },
    });

    return NextResponse.json({ success: true, locationId: finalLocationId });
  } catch (error) {
    logger.error({ error }, 'Failed to add favorite');

    // Prismaエラーハンドリング
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002': {
          // ユニーク制約違反（既にお気に入り登録済み）
          return NextResponse.json({ error: 'Already added to favorites' }, { status: 409 });
        }
        case 'P2003': {
          // 外部キー制約違反
          const meta = error.meta as { constraint?: string } | undefined;
          const constraint = meta?.constraint;
          if (constraint?.includes('user_id')) {
            // user_id外部キー制約違反 - ユーザーが存在しない
            return NextResponse.json({ error: 'User not found' }, { status: 401 });
          }
          // location_id外部キー制約違反 - ロケーションが存在しない
          return NextResponse.json({ error: 'Location not found' }, { status: 404 });
        }
        default:
          logger.error({ code: error.code }, 'Unhandled Prisma error code');
          break;
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to add favorite: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * お気に入り削除
 */
export async function DELETE(
  request: NextRequest,
): Promise<NextResponse<{ success: boolean } | { error: string }>> {
  try {
    // セッションからユーザーIDを取得（ログイン前提のアプリなので認証チェックは省略）
    const session = await auth();
    const userId = session?.user?.id;

    // UUID形式の検証（無効なセッションの場合はエラー）
    if (!isValidUUID(userId)) {
      logger.error({ userId }, 'DELETE favorites: Invalid user ID in session');
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // クエリパラメータから locationId を取得
    const searchParams = request.nextUrl.searchParams;
    const locationId = searchParams.get('locationId');

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 });
    }

    // お気に入りを削除
    const result = await prisma.user_favorites.deleteMany({
      where: {
        user_id: userId,
        location_id: locationId,
      },
    });

    // 削除件数チェック
    if (result.count === 0) {
      return NextResponse.json({ error: 'Favorite not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete favorite');

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to delete favorite: ${errorMessage}` },
      { status: 500 },
    );
  }
}
