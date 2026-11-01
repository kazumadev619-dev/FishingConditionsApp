import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock はファイル先頭に巻き上げられるため、モック本体も vi.hoisted で作る
const prismaMock = vi.hoisted(() => ({
  locations: { createMany: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  ports: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import type { FavoriteRequest } from '@/types/favorites';
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

  it('港の経路では、港に結びついていない行の名前と port_id を港に揃える', async () => {
    prismaMock.ports.findUnique.mockResolvedValue({
      id: 'port-1',
      name: '築地',
      latitude: 35.66671,
      longitude: 139.76701,
    });
    prismaMock.locations.createMany.mockResolvedValue({ count: 0 });
    prismaMock.locations.findUniqueOrThrow.mockResolvedValue({ id: 'existing' });

    await resolveLocationId({ portId: 'port-1' });

    expect(prismaMock.locations.updateMany).toHaveBeenCalledWith({
      where: { latitude: 35.6667, longitude: 139.767, port_id: null },
      data: { name: '築地', port_id: 'port-1' },
    });
  });

  it('座標の経路では、既にある行を書き換えない', async () => {
    prismaMock.locations.createMany.mockResolvedValue({ count: 0 });
    prismaMock.locations.findUniqueOrThrow.mockResolvedValue({ id: 'existing' });

    await resolveLocationId({ coordinates: { lat: 35, lng: 139, name: '別の名前' } });

    expect(prismaMock.locations.updateMany).not.toHaveBeenCalled();
  });

  it('前後の空白を除いた名前で保存する', async () => {
    prismaMock.locations.createMany.mockResolvedValue({ count: 1 });
    prismaMock.locations.findUniqueOrThrow.mockResolvedValue({ id: 'loc-1' });

    await resolveLocationId({ coordinates: { lat: 35, lng: 139, name: '  地点  ' } });

    expect(prismaMock.locations.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '地点' }),
      skipDuplicates: true,
    });
  });

  it.each([
    ['空の名前', { lat: 35, lng: 139, name: '   ' }],
    ['長すぎる名前', { lat: 35, lng: 139, name: 'あ'.repeat(201) }],
    ['文字列でない名前', { lat: 35, lng: 139, name: 123 }],
    ['名前なし', { lat: 35, lng: 139 }],
    ['NUL を含む名前', { lat: 35, lng: 139, name: 'a\0b' }],
    ['範囲外の緯度', { lat: 91, lng: 139, name: '地点' }],
    ['範囲外の経度', { lat: 35, lng: -181, name: '地点' }],
    ['文字列の座標', { lat: '35', lng: 139, name: '地点' }],
  ])('%s は 400 で、行を作らない', async (_label, coordinates) => {
    const result = await resolveLocationId({ coordinates } as FavoriteRequest);

    expect(result.success).toBe(false);
    expect(result.success === false && result.response.status).toBe(400);
    expect(prismaMock.locations.createMany).not.toHaveBeenCalled();
  });
});
