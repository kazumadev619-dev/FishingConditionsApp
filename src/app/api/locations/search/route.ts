import { type NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/apiResponseHandler';
import { isLocationSearchConfigured, searchLocations } from '@/lib/locationService';
import { logger } from '@/lib/logger';
import { withServerTiming } from '@/lib/serverTiming';
import { isValidQuery, LIMIT_REGEX } from '@/lib/validators';

export async function GET(request: NextRequest) {
  return withServerTiming('locations-search', () => handleGet(request));
}

async function handleGet(request: NextRequest) {
  try {
    if (!isLocationSearchConfigured()) {
      return createErrorResponse(
        'Location search is not configured. Please set GOOGLE_MAPS_API_KEY.',
        503,
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const limitParam = searchParams.get('limit') || '10';
    const skipCache = searchParams.get('skipCache') === 'true';

    if (!query) {
      return createErrorResponse('Missing required parameter: q', 400);
    }

    if (query.length < 2) {
      return createErrorResponse('Search query must be at least 2 characters', 400);
    }

    if (query.length > 200) {
      return createErrorResponse('Search query must be less than 200 characters', 400);
    }

    if (!isValidQuery(query)) {
      return createErrorResponse('Search query contains invalid characters', 400);
    }

    if (!LIMIT_REGEX.test(limitParam)) {
      return createErrorResponse('Invalid limit parameter. Must be a positive number.', 400);
    }

    const limit = Math.min(parseInt(limitParam, 10), 50);
    if (limit < 1) {
      return createErrorResponse('Limit must be at least 1', 400);
    }

    const response = await searchLocations(query, { skipCache, limit });

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
          // private にすること。認証必須になったので public だと共有キャッシュ
          // が保存でき、未認証リクエストが authorized() を通らないまま配られうる。
          'Cache-Control': response.fromCache ? 'private, max-age=3600' : 'private, max-age=300',
        },
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: error }, 'Location search API error');
    return NextResponse.json({ error: errorMessage, status: 500 }, { status: 500 });
  }
}
