import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { findNearestPort } from '@/lib/portMappingService';
import { z } from 'zod';

// リクエストボディのスキーマ定義
const LocationCreateSchema = z.object({
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  prefecture: z.string().max(50).optional(),
  region: z.string().max(100).optional(),
  portId: z.string().uuid().optional(), // パターンB: 港選択時に指定
});

export async function GET() {
  try {
    const locations = await prisma.locations.findMany();
    return NextResponse.json(locations);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching locations');
    return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 500 });
  }
}

/**
 * POST /api/locations
 * 釣り場を保存（認証必須）
 *
 * パターンA（自由検索）: Google Geocoding結果 + 最寄り港マッピング
 * パターンB（港選択）: port_id を直接指定
 */
export async function POST(request: NextRequest) {
  try {
    // セッションチェック
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 403 });
    }

    // リクエストボディのパース
    const body = await request.json();
    const validationResult = LocationCreateSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.issues,
        },
        { status: 400 },
      );
    }

    const { name, latitude, longitude, prefecture, region, portId } = validationResult.data;

    // 重複チェック（緯度経度で0.001度以内なら同一と判定）
    const TOLERANCE = 0.001;
    const existingLocation = await prisma.locations.findFirst({
      where: {
        latitude: {
          gte: latitude - TOLERANCE,
          lte: latitude + TOLERANCE,
        },
        longitude: {
          gte: longitude - TOLERANCE,
          lte: longitude + TOLERANCE,
        },
      },
    });

    if (existingLocation) {
      // 既存のlocationを返す
      logger.info(
        {
          locationId: existingLocation.id,
          lat: latitude,
          lng: longitude,
        },
        'Location already exists, returning existing record',
      );

      return NextResponse.json({
        id: existingLocation.id,
        name: existingLocation.name,
        latitude: existingLocation.latitude,
        longitude: existingLocation.longitude,
        prefecture: existingLocation.prefecture,
        region: existingLocation.region,
        port_id: existingLocation.port_id,
        nearestPortDistance: null, // 既存データなので計算しない
      });
    }

    // port_idの決定
    let finalPortId: string | null = null;
    let nearestPortDistance: number | null = null;

    if (portId) {
      // パターンB: 港選択時は直接指定
      finalPortId = portId;
      logger.info({ portId }, 'Port ID directly specified (Pattern B: Port Selection)');
    } else {
      // パターンA: 自由検索時は最寄り港マッピング
      try {
        const nearestPort = await findNearestPort(latitude, longitude);
        if (nearestPort) {
          finalPortId = nearestPort.id;
          nearestPortDistance = nearestPort.distance;
          logger.info(
            {
              portId: nearestPort.id,
              portName: nearestPort.name,
              distance: nearestPort.distance,
            },
            'Nearest port found (Pattern A: Free Search)',
          );
        } else {
          logger.warn({ lat: latitude, lng: longitude }, 'No nearest port found');
        }
      } catch (error) {
        logger.error({ err: error, lat: latitude, lng: longitude }, 'Error finding nearest port');
        // 最寄り港が見つからなくてもlocation保存は続行（port_id = null）
      }
    }

    // locations保存
    const newLocation = await prisma.locations.create({
      data: {
        name,
        latitude,
        longitude,
        prefecture: prefecture || null,
        region: region || null,
        port_id: finalPortId,
      },
    });

    logger.info(
      {
        locationId: newLocation.id,
        portId: finalPortId,
        userId: session.user.id,
      },
      'Location saved successfully',
    );

    return NextResponse.json({
      id: newLocation.id,
      name: newLocation.name,
      latitude: newLocation.latitude,
      longitude: newLocation.longitude,
      prefecture: newLocation.prefecture,
      region: newLocation.region,
      port_id: newLocation.port_id,
      nearestPortDistance,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: error }, 'Location save API error');

    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
