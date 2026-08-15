import { type NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/apiResponseHandler';
import { logger } from '@/lib/logger';
import { withServerTiming } from '@/lib/serverTiming';
import { getTideData } from '@/lib/tideService';
import {
  getTodayDateString,
  isValidDateString,
  PORT_CODE_REGEX,
  PREFECTURE_CODE_REGEX,
} from '@/lib/validators';

export async function GET(request: NextRequest) {
  return withServerTiming('tide', () => handleGet(request));
}

async function handleGet(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const prefectureCode = searchParams.get('prefectureCode');
    const portCode = searchParams.get('portCode');
    const date = searchParams.get('date') || getTodayDateString();
    const range = (searchParams.get('range') as 'day' | 'week' | 'month') || 'week';
    const skipCache = searchParams.get('skipCache') === 'true';

    if (!prefectureCode) {
      return createErrorResponse('Missing required parameter: prefectureCode', 400);
    }

    if (!portCode) {
      return createErrorResponse('Missing required parameter: portCode', 400);
    }

    if (!PREFECTURE_CODE_REGEX.test(prefectureCode)) {
      return createErrorResponse('Invalid prefectureCode format', 400);
    }

    if (!PORT_CODE_REGEX.test(portCode)) {
      return createErrorResponse('Invalid portCode format', 400);
    }

    if (!isValidDateString(date)) {
      return createErrorResponse('Invalid date. Use an existing date in YYYY-MM-DD format', 400);
    }

    if (!['day', 'week', 'month'].includes(range)) {
      return createErrorResponse('Invalid range. Must be one of: day, week, month', 400);
    }

    const response = await getTideData(prefectureCode, portCode, date, {
      skipCache,
      range,
    });

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
          'Cache-Control': response.fromCache ? 'public, max-age=3600' : 'public, max-age=300',
        },
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: error }, 'Tide API error');
    return NextResponse.json({ error: errorMessage, status: 500 }, { status: 500 });
  }
}
