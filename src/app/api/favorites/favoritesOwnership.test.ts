import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 守る状態（#362）: お気に入りの行は、セッションのユーザーのものだけを作り・消す。
// - POST は user_id をセッションから取る。本文に別のユーザーの id があっても使わない
// - DELETE は自分の行だけを消す（where に user_id を入れる。外すと他人の同じ地点の行も消える）
// - セッションの id が UUID でなければ、DB に書かずに 401 を返す
//   （/api/* の未認証は 401。docs/reference/authentication.md の「上記以外の /api/*」）
// Prisma は暫定規則（testing-policy.md 5節）で、書き込みの引数を検証する
const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    ports: { findUnique: vi.fn() },
    user_favorites: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { DELETE } from './handlers/deleteFavorite';
import { POST } from './route';

const SESSION_USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';

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
  // 既定はログイン済み。未準備の undefined で分岐が変わらないよう、書き込みの戻り値も用意する
  authMock.mockResolvedValue({ user: { id: SESSION_USER_ID } });
  prismaMock.user_favorites.create.mockResolvedValue({
    id: '55555555-5555-4555-8555-555555555555',
    user_id: SESSION_USER_ID,
    location_id: LOCATION_ID,
  });
  prismaMock.user_favorites.deleteMany.mockResolvedValue({ count: 1 });
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
// 検証が無いと、DELETE は全ユーザーのその地点の行を消し、POST は所有者のない行を作ろうとする
describe('セッションの id が UUID でなければ、DB に書かずに 401（#362）', () => {
  const invalidSessions = [
    ['セッションが無い', null],
    ['user が無い', {}],
    ['id が無い', { user: {} }],
    ['id が UUID でない', { user: { id: 'not-a-uuid' } }],
  ] as const;

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
