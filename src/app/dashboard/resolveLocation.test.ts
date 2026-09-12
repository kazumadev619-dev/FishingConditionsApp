import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock はファイル先頭に巻き上げられるため、モック本体も vi.hoisted で作る
const prismaMock = vi.hoisted(() => ({
  locations: { findUnique: vi.fn(), findFirst: vi.fn() },
  ports: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/portMappingService', () => ({ findNearestPort: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { findNearestPort } from '@/lib/portMappingService';
import { DEFAULT_LOCATION, resolveLocation } from './resolveLocation';

const TSUKIJI_PORT = {
  id: 'port-1',
  name: '築地',
  prefecture_code: '13',
  port_code: '2',
  latitude: 35.6667,
  longitude: 139.767,
};

/** 築地港と同じ座標で既に作られている locations 行（お気に入り登録済みの地点） */
const TSUKIJI_LOCATION = {
  id: 'loc-1',
  name: '築地',
  latitude: 35.6667,
  longitude: 139.767,
  port: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.locations.findUnique.mockResolvedValue(null);
  prismaMock.locations.findFirst.mockResolvedValue(null);
  prismaMock.ports.findUnique.mockResolvedValue(null);
});

describe('resolveLocation（?portId=）', () => {
  it('同じ座標の locations が既にあれば、その id を返す', async () => {
    // #78: id を返さないと、クライアントは「お気に入り未登録」と判断して
    // POST /api/favorites を投げ、user_favorites の unique 制約で 409 になる
    prismaMock.ports.findUnique.mockResolvedValue(TSUKIJI_PORT);
    prismaMock.locations.findFirst.mockResolvedValue(TSUKIJI_LOCATION);

    const location = await resolveLocation({ portId: 'port-1' });

    expect(location.id).toBe('loc-1');
    expect(location.source).toEqual({ type: 'port', portId: 'port-1' });
  });

  it('対応する locations がまだ無ければ id は付かない', async () => {
    prismaMock.ports.findUnique.mockResolvedValue(TSUKIJI_PORT);

    const location = await resolveLocation({ portId: 'port-1' });

    expect(location.id).toBeUndefined();
    expect(location.name).toBe('築地');
  });

  it('港が見つからなければデフォルト地点を返す', async () => {
    const location = await resolveLocation({ portId: 'unknown' });

    expect(location).toEqual(DEFAULT_LOCATION);
  });
});

describe('resolveLocation（?lat=&lng=）', () => {
  it('同じ座標の locations が既にあれば、その id を返す', async () => {
    vi.mocked(findNearestPort).mockResolvedValue({
      ...TSUKIJI_PORT,
      distance: 0,
    } as unknown as Awaited<ReturnType<typeof findNearestPort>>);
    prismaMock.locations.findFirst.mockResolvedValue(TSUKIJI_LOCATION);

    const location = await resolveLocation({ lat: '35.6667', lng: '139.767', name: '築地' });

    expect(location.id).toBe('loc-1');
  });

  it('範囲外の座標はデフォルト地点を返す', async () => {
    const location = await resolveLocation({ lat: '999', lng: '139.767' });

    expect(location).toEqual(DEFAULT_LOCATION);
    expect(findNearestPort).not.toHaveBeenCalled();
  });
});

describe('resolveLocation（?locationId=）', () => {
  it('locations の id をそのまま返す', async () => {
    prismaMock.locations.findUnique.mockResolvedValue({
      ...TSUKIJI_LOCATION,
      port: TSUKIJI_PORT,
    });

    const location = await resolveLocation({ locationId: 'loc-1' });

    expect(location.id).toBe('loc-1');
    expect(location.prefectureCode).toBe('13');
    expect(location.portCode).toBe('2');
  });
});
