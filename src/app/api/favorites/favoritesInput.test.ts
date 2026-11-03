import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { DELETE } from './handlers/deleteFavorite';
import { POST } from './route';

const userId = '11111111-1111-4111-8111-111111111111';

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: userId } }) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    ports: { findUnique: vi.fn() },
    user_favorites: { create: vi.fn(), deleteMany: vi.fn() },
  },
}));

const post = (body: string) =>
  POST(
    new NextRequest('https://app.test/api/favorites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );

const del = (query: string) =>
  DELETE(new NextRequest(`https://app.test/api/favorites${query}`, { method: 'DELETE' }));

afterEach(() => vi.clearAllMocks());

// 入力の誤りは 500 ではなく 400 で返す（#330）。
// 実 DB では UUID でない値が列（@db.Uuid）の変換で失敗して 500 になることを確かめてある
describe('POST /api/favorites の入力の誤りは 400', () => {
  it.each([
    ['JSON として解釈できない本文', 'not-json', 'Invalid JSON'],
    ['本文が null', 'null', 'Invalid request'],
    ['UUID でない locationId', '{"locationId":"not-a-uuid"}', 'Invalid locationId'],
    ['文字列でない locationId', '{"locationId":123}', 'Invalid locationId'],
    ['UUID でない portId', '{"portId":"not-a-uuid"}', 'Invalid portId'],
  ])('%s', async (_name, body, error) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(prisma.ports.findUnique).not.toHaveBeenCalled();
    expect(prisma.user_favorites.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/favorites の入力の誤りは 400', () => {
  it('UUID でない locationId', async () => {
    const response = await del('?locationId=not-a-uuid');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid locationId' });
    expect(prisma.user_favorites.deleteMany).not.toHaveBeenCalled();
  });
});
