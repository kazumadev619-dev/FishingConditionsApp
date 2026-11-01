import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toLocationCoordinates } from '@/lib/locationIdentity';
import prisma from '@/lib/prisma';
import type { FavoriteRequest } from '@/types/favorites';

const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  name: z.string().trim().min(1).max(200),
});

type LocationResult =
  | { success: true; locationId: string }
  | { success: false; response: NextResponse<{ error: string }> };

/**
 * 座標に対応する locations を返す。無ければ作る。
 *
 * 検索条件（丸め）はダッシュボード側の id 解決と同じ規則を使う。
 * ここだけ独自に丸めると「表示は未登録・DB は登録済み」がずれて 409 になる（#78）。
 *
 * 探してから作る2段階にすると、同じ座標への同時リクエストで行が重複する（#151）。
 * (latitude, longitude) の unique に対して INSERT ... ON CONFLICT DO NOTHING し、
 * 勝った行を引き直す。prisma の upsert は update が空だと SELECT → INSERT に
 * 展開されて同じ競合で P2002 を投げるので使わない。
 *
 * 港の経路では港のデータを正とし、既に行があれば名前と port_id を港に揃える。
 * locations は全員で共有するので、座標の経路で先に作られた名前を残さない。
 */
async function findOrCreateLocation(
  latitude: number,
  longitude: number,
  name: string,
  portId: string | null,
): Promise<string> {
  const coordinates = toLocationCoordinates(latitude, longitude);

  await prisma.locations.createMany({
    data: {
      name,
      ...coordinates,
      region: null,
      prefecture: null,
      port_id: portId,
    },
    skipDuplicates: true,
  });

  if (portId) {
    await prisma.locations.updateMany({
      where: coordinates,
      data: { name, port_id: portId },
    });
  }

  const location = await prisma.locations.findUniqueOrThrow({
    where: { latitude_longitude: coordinates },
    select: { id: true },
  });

  return location.id;
}

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

    return {
      success: true,
      locationId: await findOrCreateLocation(port.latitude, port.longitude, port.name, portId),
    };
  }

  if (coordinates) {
    const parsed = CoordinatesSchema.safeParse(coordinates);

    if (!parsed.success) {
      return {
        success: false,
        response: NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 }),
      };
    }

    const { lat, lng, name } = parsed.data;

    return {
      success: true,
      locationId: await findOrCreateLocation(lat, lng, name, null),
    };
  }

  return {
    success: false,
    response: NextResponse.json({ error: 'Invalid request' }, { status: 400 }),
  };
}
