import { describe, expect, it, vi } from 'vitest';

// probe が10秒ごとに叩くので、DB・Redis を掴んだ時点で import ごと落とす（#187）。
// 推移的な import も Vite のリゾルバが辿り、解決できない import は import 時に落ちる。
const forbid = vi.hoisted(() => () => {
  throw new Error('/healthz は DB・Redis に依存しないこと（#187）');
});
vi.mock('@/lib/prisma', forbid);
vi.mock('@/lib/cache/client', forbid);
vi.mock('pg', forbid);
// adapter-pg の中の import pg は Vite を通らないので、pg のモックが効かない
vi.mock('@prisma/adapter-pg', forbid);
vi.mock('ioredis', forbid);

describe('/healthz', () => {
  it('DB・Redis に推移的にも依存せず 200 を返す', async () => {
    const { GET } = await import('./route');
    expect((await GET()).status).toBe(200);
  });
});
