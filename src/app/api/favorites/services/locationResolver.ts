import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { roundCoordinate } from '@/lib/validators';
import type { FavoriteRequest } from '@/types/favorites';

type LocationResult =
  | { success: true; locationId: string }
  | { success: false; response: NextResponse<{ error: string }> };

export async function resolveLocationId(body: FavoriteRequest): Promise<LocationResult> {
  const { locationId, portId, coordinates } = body;

  if (!locationId && !portId && !coordinates) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'locationId, portId, or coordinates is required' },
        { status: 400 },
      ),
    };
  }

  if (locationId) {
    return { success: true, locationId };
  }

  if (portId) {
    const port = await prisma.ports.findUnique({ where: { id: portId } });

    if (!port) {
      return {
        success: false,
        response: NextResponse.json({ error: 'Port not found' }, { status: 404 }),
      };
    }

    if (!port.latitude || !port.longitude) {
      return {
        success: false,
        response: NextResponse.json({ error: 'Port has no coordinates' }, { status: 400 }),
      };
    }

    const roundedLat = roundCoordinate(port.latitude);
    const roundedLng = roundCoordinate(port.longitude);

    const existingLocation = await prisma.locations.findFirst({
      where: { latitude: roundedLat, longitude: roundedLng },
    });

    if (existingLocation) {
      return { success: true, locationId: existingLocation.id };
    }

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

    return { success: true, locationId: newLocation.id };
  }

  if (coordinates) {
    const { lat, lng, name } = coordinates;

    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return {
        success: false,
        response: NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 }),
      };
    }

    const roundedLat = roundCoordinate(lat);
    const roundedLng = roundCoordinate(lng);

    const existingLocation = await prisma.locations.findFirst({
      where: { latitude: roundedLat, longitude: roundedLng },
    });

    if (existingLocation) {
      return { success: true, locationId: existingLocation.id };
    }

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

    return { success: true, locationId: newLocation.id };
  }

  return {
    success: false,
    response: NextResponse.json({ error: 'Invalid request' }, { status: 400 }),
  };
}
