import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock はファイル先頭に巻き上げられるため、モック本体も vi.hoisted で作る
const prismaMock = vi.hoisted(() => ({
  locations: { createMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  ports: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { resolveLocationId } from './locationResolver';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveLocationId（座標から locations を作る）', () => {
  it('同時リクエストに負けて INSERT が空振りしても、先に作られた行の id を返す（#151）', async () => {
    // 探してから作る2段階だと、両方が「無い」と判断して両方 create し、行が重複する。
    // INSERT ... ON CONFLICT DO NOTHING で DB に1行だけ作らせ、unique キーで引き直す
    prismaMock.locations.createMany.mockResolvedValue({ count: 0 });
    prismaMock.locations.findUniqueOrThrow.mockResolvedValue({ id: 'winner' });

    const result = await resolveLocationId({
      coordinates: { lat: 35.123456, lng: 139.876543, name: '地点' },
    });

    expect(result).toEqual({ success: true, locationId: 'winner' });
    expect(prismaMock.locations.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '地点', latitude: 35.1235, longitude: 139.8765 }),
      skipDuplicates: true,
    });
    // 作るときと同じ丸めで引かないと、別の行を返したり見つけられなかったりする（#78）
    expect(prismaMock.locations.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { latitude_longitude: { latitude: 35.1235, longitude: 139.8765 } },
      select: { id: true },
    });
  });

  it('港から作るときは port_id を付ける', async () => {
    prismaMock.ports.findUnique.mockResolvedValue({
      id: 'port-1',
      name: '築地',
      latitude: 35.6667,
      longitude: 139.767,
    });
    prismaMock.locations.createMany.mockResolvedValue({ count: 1 });
    prismaMock.locations.findUniqueOrThrow.mockResolvedValue({ id: 'loc-1' });

    const result = await resolveLocationId({ portId: 'port-1' });

    expect(result).toEqual({ success: true, locationId: 'loc-1' });
    expect(prismaMock.locations.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '築地', port_id: 'port-1' }),
      skipDuplicates: true,
    });
  });
});
