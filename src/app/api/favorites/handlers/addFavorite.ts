import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { isValidUUID } from '@/lib/validators';
import type {
  FavoriteAddResponse,
  FavoriteErrorResponse,
  FavoriteRequest,
} from '@/types/favorites';
import { resolveLocationId } from '../services/locationResolver';

type AddFavoriteResponse = NextResponse<FavoriteAddResponse | FavoriteErrorResponse>;

/**
 * user_favorites への登録で Prisma が返した既知のエラーをレスポンスに変換する。
 * 既知の形でなければ null を返し、呼び出し元で 500 として扱う。
 */
function toKnownErrorResponse(error: unknown, locationId: string): AddFavoriteResponse | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  switch (error.code) {
    case 'P2002':
      // 既に登録済み。どの地点かは確定しているので locationId を返し、
      // クライアントが「未登録」の表示から正しい状態へ復帰できるようにする（#78）
      logger.warn({ locationId }, 'POST favorites: already in favorites');
      return NextResponse.json(
        { error: 'Already added to favorites', locationId },
        { status: 409 },
      );

    case 'P2003': {
      const meta = error.meta as { constraint?: string } | undefined;
      if (meta?.constraint?.includes('user_id')) {
        return NextResponse.json({ error: 'User not found' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    default:
      logger.error({ code: error.code }, 'Unhandled Prisma error code');
      return null;
  }
}

export async function POST(request: NextRequest): Promise<AddFavoriteResponse> {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!isValidUUID(userId)) {
      logger.error({ userId }, 'POST favorites: Invalid user ID in session');
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body: FavoriteRequest = await request.json();
    const result = await resolveLocationId(body);

    if (!result.success) {
      return result.response;
    }

    try {
      await prisma.user_favorites.create({
        data: {
          user_id: userId as string,
          location_id: result.locationId,
        },
      });
    } catch (error) {
      const known = toKnownErrorResponse(error, result.locationId);
      if (known) {
        return known;
      }
      throw error;
    }

    return NextResponse.json({ success: true, locationId: result.locationId });
  } catch (error) {
    logger.error({ error }, 'Failed to add favorite');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to add favorite: ${errorMessage}` }, { status: 500 });
  }
}
