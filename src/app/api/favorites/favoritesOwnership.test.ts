import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 守る状態（#362, #466）: お気に入りの行は、セッションのユーザーのものだけを読み・作り・消す。
// - GET は自分の行だけを返す（where に user_id を入れる。外すと他人の行も返る）
// - POST は user_id をセッションから取る。本文に別のユーザーの id があっても使わない
// - DELETE は自分の行だけを消す（where に user_id を入れる。外すと他人の同じ地点の行も消える）
// - セッションの id が UUID でなければ、DB を読まず・書かずに 401 を返す
//   （/api/* の未認証は 401。docs/reference/authentication.md の「上記以外の /api/*」はミドルウェアの規定で、
//   ハンドラ内の「id が UUID でない」への 401 は、そこからの類推。#362 / #466 が求めるのは、検証を外したら落ちること）
// Prisma は暫定規則（testing-policy.md 5節）で、書き込みの引数を検証し、読み取りはスタブで絞り込みを再現する。
// ただし 401 時に GET が DB を読まないことは、#466 の完了条件のため、呼ばれていないことを検証する
const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    ports: { findUnique: vi.fn() },
    user_favorites: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { DELETE } from './handlers/deleteFavorite';
import { GET, POST } from './route';

const SESSION_USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_LOCATION_ID = '66666666-6666-4666-8666-666666666666';

const SESSION_FAVORITE_ROW = {
  id: '55555555-5555-4555-8555-555555555555',
  user_id: SESSION_USER_ID,
  location_id: LOCATION_ID,
  created_at: new Date('2026-11-01T00:00:00.000Z'),
  location: {
    name: '東京湾テスト港',
    latitude: 35.6,
    longitude: 139.7,
    region: '関東',
    prefecture: '東京都',
  },
};

const OTHER_FAVORITE_ROW = {
  id: '77777777-7777-4777-8777-777777777777',
  user_id: OTHER_USER_ID,
  location_id: OTHER_LOCATION_ID,
  created_at: new Date('2026-11-02T00:00:00.000Z'),
  location: {
    name: '他ユーザーの港',
    latitude: 34.7,
    longitude: 135.5,
    region: '関西',
    prefecture: '大阪府',
  },
};

const post = (body: unknown) =>
  POST(
    new NextRequest('https://app.test/api/favorites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const del = (locationId: string, extraQuery = '') =>
  DELETE(
    new NextRequest(`https://app.test/api/favorites?locationId=${locationId}${extraQuery}`, {
      method: 'DELETE',
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  // 既定はログイン済み。未準備の undefined で分岐が変わらないよう、読み書きの戻り値も用意する
  authMock.mockResolvedValue({ user: { id: SESSION_USER_ID } });
  // where.user_id を外すと他人の行も返る実 DB の挙動を再現する（#466）
  prismaMock.user_favorites.findMany.mockImplementation(
    async (args?: { where?: { user_id?: string } }) => {
      const rows = [SESSION_FAVORITE_ROW, OTHER_FAVORITE_ROW];
      const userIdFilter = args?.where?.user_id;
      return userIdFilter === undefined ? rows : rows.filter((row) => row.user_id === userIdFilter);
    },
  );
  prismaMock.user_favorites.create.mockResolvedValue({
    id: '55555555-5555-4555-8555-555555555555',
    user_id: SESSION_USER_ID,
    location_id: LOCATION_ID,
  });
  prismaMock.user_favorites.deleteMany.mockResolvedValue({ count: 1 });
});

describe('GET /api/favorites は自分の行だけを返す（#466）', () => {
  it('where にセッションの user_id を入れ、そのユーザーのお気に入り一覧だけを返す', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      favorites: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          locationId: LOCATION_ID,
          name: '東京湾テスト港',
          latitude: 35.6,
          longitude: 139.7,
          region: '関東',
          prefecture: '東京都',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      count: 1,
    });
  });

  // 1 ユーザーのみのテストでは where.user_id の定数固定やリクエスト跨ぎのキャッシュ混線を見逃すため、
  // 別ユーザーへ切り替えたときに前のユーザーの行が混じらないことも検証する
  it('セッションを別ユーザーに切り替えると、前のユーザーの行を混ぜずそのユーザーの行だけを返す', async () => {
    const firstResponse = await GET();
    expect(firstResponse.status).toBe(200);

    authMock.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    const secondResponse = await GET();

    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({
      favorites: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          locationId: OTHER_LOCATION_ID,
          name: '他ユーザーの港',
          latitude: 34.7,
          longitude: 135.5,
          region: '関西',
          prefecture: '大阪府',
          createdAt: '2026-11-02T00:00:00.000Z',
        },
      ],
      count: 1,
    });
  });

  it('お気に入りが 0 件のユーザーでは { favorites: [], count: 0 } を返す（#475）', async () => {
    authMock.mockResolvedValue({ user: { id: '22222222-2222-4222-8222-222222222222' } });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      favorites: [],
      count: 0,
    });
  });

  it('複数件ある場合は created_at 降順で返し、座標登録地点の region / prefecture は null で整形する（#475）', async () => {
    const olderRow = SESSION_FAVORITE_ROW;
    const newerCoordinateRow = {
      id: '88888888-8888-4888-8888-888888888888',
      user_id: SESSION_USER_ID,
      location_id: '99999999-9999-4999-8999-999999999999',
      created_at: new Date('2026-11-03T00:00:00.000Z'),
      location: {
        name: '相模湾沖ポイント',
        latitude: 35.2,
        longitude: 139.4,
        region: null,
        prefecture: null,
      },
    };

    // 古い行が先にある状態で、orderBy.created_at が指定されたときだけ並び替える実 DB の挙動を再現する
    prismaMock.user_favorites.findMany.mockImplementationOnce(
      async (args?: {
        where?: { user_id?: string };
        orderBy?: { created_at?: 'asc' | 'desc' };
      }) => {
        const rows = [olderRow, newerCoordinateRow, OTHER_FAVORITE_ROW];
        const filtered =
          args?.where?.user_id === undefined
            ? rows
            : rows.filter((row) => row.user_id === args.where?.user_id);
        const dir = args?.orderBy?.created_at;
        if (dir === 'desc') {
          return [...filtered].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        }
        if (dir === 'asc') {
          return [...filtered].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
        }
        return filtered;
      },
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      favorites: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          locationId: '99999999-9999-4999-8999-999999999999',
          name: '相模湾沖ポイント',
          latitude: 35.2,
          longitude: 139.4,
          region: null,
          prefecture: null,
          createdAt: '2026-11-03T00:00:00.000Z',
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          locationId: LOCATION_ID,
          name: '東京湾テスト港',
          latitude: 35.6,
          longitude: 139.7,
          region: '関東',
          prefecture: '東京都',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      count: 2,
    });
  });
});

describe('POST /api/favorites はセッションのユーザーで登録する（#362）', () => {
  it('本文に別のユーザーの id があっても、user_id はセッションの id になる', async () => {
    const response = await post({
      locationId: LOCATION_ID,
      userId: OTHER_USER_ID,
      user_id: OTHER_USER_ID,
    });

    expect(response.status).toBe(200);
    expect(prismaMock.user_favorites.create).toHaveBeenCalledWith({
      data: { user_id: SESSION_USER_ID, location_id: LOCATION_ID },
    });
  });
});

describe('DELETE /api/favorites は自分の行だけを消す（#362）', () => {
  it('where にセッションの user_id と locationId の両方を入れる', async () => {
    const response = await del(LOCATION_ID);

    expect(response.status).toBe(200);
    expect(prismaMock.user_favorites.deleteMany).toHaveBeenCalledWith({
      where: { user_id: SESSION_USER_ID, location_id: LOCATION_ID },
    });
  });

  it('クエリに別のユーザーの id があっても、where の user_id はセッションの id になる', async () => {
    const response = await del(LOCATION_ID, `&userId=${OTHER_USER_ID}&user_id=${OTHER_USER_ID}`);

    expect(response.status).toBe(200);
    expect(prismaMock.user_favorites.deleteMany).toHaveBeenCalledWith({
      where: { user_id: SESSION_USER_ID, location_id: LOCATION_ID },
    });
  });
});

// Prisma は where の値が undefined だと条件ごと無視する。
// 検証が無いと、GET は全ユーザーの行を返し、DELETE は全ユーザーのその地点の行を消し、POST は所有者のない行を作ろうとする
describe('セッションの id が UUID でなければ、DB に読書きせず 401（#362, #466）', () => {
  const invalidSessions = [
    ['セッションが無い', null],
    ['user が無い', {}],
    ['id が無い', { user: {} }],
    ['id が空文字（sessionCallback の不正トークン時）', { user: { id: '' } }],
    ['id が UUID でない', { user: { id: 'not-a-uuid' } }],
  ] as const;

  it.each(invalidSessions)('GET: %s', async (_name, session) => {
    authMock.mockResolvedValue(session);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid session' });
    expect(prismaMock.user_favorites.findMany).not.toHaveBeenCalled();
  });

  it.each(invalidSessions)('POST: %s', async (_name, session) => {
    authMock.mockResolvedValue(session);

    const response = await post({ locationId: LOCATION_ID });

    expect(response.status).toBe(401);
    expect(prismaMock.user_favorites.create).not.toHaveBeenCalled();
  });

  it.each(invalidSessions)('DELETE: %s', async (_name, session) => {
    authMock.mockResolvedValue(session);

    const response = await del(LOCATION_ID);

    expect(response.status).toBe(401);
    expect(prismaMock.user_favorites.deleteMany).not.toHaveBeenCalled();
  });
});
