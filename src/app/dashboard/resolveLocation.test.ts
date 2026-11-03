import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock はファイル先頭に巻き上げられるため、モック本体も vi.hoisted で作る
const prismaMock = vi.hoisted(() => ({
  locations: { findUnique: vi.fn(), findFirst: vi.fn() },
  ports: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/portMappingService', () => ({ findNearestPort: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({ isUserRateLimited: vi.fn(async () => false) }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { findNearestPort } from '@/lib/portMappingService';
import { isUserRateLimited } from '@/lib/rateLimit';
import { DEFAULT_LOCATION, resolveLocation } from './resolveLocation';

const PORT_ID = '11111111-1111-4111-8111-111111111111';
const LOCATION_ID = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_ID = '33333333-3333-4333-8333-333333333333';

const TSUKIJI_PORT = {
  id: PORT_ID,
  name: '築地',
  prefecture_code: '13',
  port_code: '2',
  latitude: 35.6667,
  longitude: 139.767,
};

/** 築地港と同じ座標で既に作られている locations 行（お気に入り登録済みの地点） */
const TSUKIJI_LOCATION = {
  id: LOCATION_ID,
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

    const location = await resolveLocation({ portId: PORT_ID });

    expect(location.id).toBe(LOCATION_ID);
    expect(location.source).toEqual({ type: 'port', portId: PORT_ID });
  });

  it('対応する locations がまだ無ければ id は付かない', async () => {
    prismaMock.ports.findUnique.mockResolvedValue(TSUKIJI_PORT);

    const location = await resolveLocation({ portId: PORT_ID });

    expect(location.id).toBeUndefined();
    expect(location.name).toBe('築地');
  });

  it('港が見つからなければデフォルト地点を返す', async () => {
    const location = await resolveLocation({ portId: UNKNOWN_ID });

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

    expect(location.id).toBe(LOCATION_ID);
  });

  it('上限を超えたら最寄り港を探さず、デフォルト地点に落とす', async () => {
    vi.mocked(isUserRateLimited).mockResolvedValueOnce(true);

    const location = await resolveLocation({ lat: '35.6667', lng: '139.767' });

    expect(location).toEqual(DEFAULT_LOCATION);
    expect(findNearestPort).not.toHaveBeenCalled();
  });

  it('不正な座標は回数に数えない', async () => {
    await resolveLocation({ lat: '999', lng: '139.767' });

    expect(isUserRateLimited).not.toHaveBeenCalled();
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

    const location = await resolveLocation({ locationId: LOCATION_ID });

    expect(location.id).toBe(LOCATION_ID);
    expect(location.prefectureCode).toBe('13');
    expect(location.portCode).toBe('2');
  });
});

describe('resolveLocation（DB 障害時）', () => {
  it('id を引けなくても地点そのものは返す', async () => {
    // 解決パターン側は DB 障害をデフォルト地点に落としている。
    // 出口の id 解決だけが投げると、その保険が効かずダッシュボードごと落ちる
    prismaMock.ports.findUnique.mockResolvedValue(TSUKIJI_PORT);
    prismaMock.locations.findFirst.mockRejectedValue(new Error('DB unreachable'));

    const location = await resolveLocation({ portId: PORT_ID });

    expect(location.id).toBeUndefined();
    expect(location.name).toBe('築地');
  });
});

describe('resolveLocation（UUID でない id）', () => {
  // #340: @db.Uuid 列に渡すと DB が失敗して ERROR ログが出る。URL を書き換えるだけで出せてしまう
  it.each([
    ['locationId', { locationId: 'not-a-uuid' }],
    ['portId', { portId: 'not-a-uuid' }],
  ])('%s が UUID でなければ DB に問い合わせず、warn でデフォルト地点を返す', async (_, params) => {
    const location = await resolveLocation(params);

    expect(location).toEqual(DEFAULT_LOCATION);
    expect(prismaMock.locations.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.ports.findUnique).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
