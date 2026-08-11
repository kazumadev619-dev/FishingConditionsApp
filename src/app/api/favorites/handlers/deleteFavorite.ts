import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { isValidUUID } from '@/lib/validators';

export async function DELETE(
  request: NextRequest,
): Promise<NextResponse<{ success: boolean } | { error: string }>> {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!isValidUUID(userId)) {
      logger.error({ userId }, 'DELETE favorites: Invalid user ID in session');
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const locationId = searchParams.get('locationId');

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 });
    }

    const result = await prisma.user_favorites.deleteMany({
      where: { user_id: userId, location_id: locationId },
    });

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
