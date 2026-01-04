import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const locations = await prisma.locations.findMany();
    return NextResponse.json(locations);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching locations');
    return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 500 });
  }
}
