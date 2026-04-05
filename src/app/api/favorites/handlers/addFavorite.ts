import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { isValidUUID } from '@/lib/validators';
import type { FavoriteAddResponse, FavoriteRequest } from '@/types/favorites';
import { resolveLocationId } from '../services/locationResolver';

export async function POST(
  request: NextRequest,
): Promise<NextResponse<FavoriteAddResponse | { error: string }>> {
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

    await prisma.user_favorites.create({
      data: {
        user_id: userId as string,
        location_id: result.locationId,
      },
    });

    return NextResponse.json({ success: true, locationId: result.locationId });
  } catch (error) {
    logger.error({ error }, 'Failed to add favorite');

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002': {
          return NextResponse.json({ error: 'Already added to favorites' }, { status: 409 });
        }
        case 'P2003': {
          const meta = error.meta as { constraint?: string } | undefined;
          const constraint = meta?.constraint;
          if (constraint?.includes('user_id')) {
            return NextResponse.json({ error: 'User not found' }, { status: 401 });
          }
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
