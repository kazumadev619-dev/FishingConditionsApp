import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { isValidUUID } from '@/lib/validators';
import type { FavoriteLocation, FavoritesResponse } from '@/types/favorites';

export async function GET(): Promise<NextResponse<FavoritesResponse | { error: string }>> {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!isValidUUID(userId)) {
      logger.error({ userId }, 'GET favorites: Invalid user ID in session');
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const favorites = await prisma.user_favorites.findMany({
      where: { user_id: userId },
      include: { location: true },
      orderBy: { created_at: 'desc' },
    });

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
