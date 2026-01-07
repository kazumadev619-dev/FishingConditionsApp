/**
 * 港マスタ取得API
 * GET /api/ports?prefecture_code=13
 * 認証不要（公開API）
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const prefectureCode = searchParams.get('prefecture_code');

    logger.info({ prefectureCode }, '港マスタ取得リクエスト');

    // prefecture_code指定がある場合はフィルタリング
    const where = prefectureCode ? { prefecture_code: prefectureCode } : {};

    const ports = await prisma.ports.findMany({
      where,
      select: {
        id: true,
        name: true,
        prefecture_code: true,
        port_code: true,
        latitude: true,
        longitude: true,
      },
      orderBy: [{ prefecture_code: 'asc' }, { port_code: 'asc' }],
    });

    logger.info({ count: ports.length, prefectureCode }, '港マスタ取得成功');

    return NextResponse.json({
      ports,
      total: ports.length,
    });
  } catch (error) {
    logger.error({ error }, '港マスタ取得エラー');
    return NextResponse.json(
      {
        error: '港情報の取得に失敗しました',
        details: error instanceof Error ? error.message : '不明なエラー',
      },
      { status: 500 },
    );
  }
}
