import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * 接続時のコマンド（CLIENT / INFO）にだけ答え、MULTI や GET からは黙る TCP サーバー。
 * 接続は保ったままなので ioredis の status は ready のまま、isAvailable() は true になる。
 */
const sockets = new Set<net.Socket>();
function startUnresponsiveRedis(): Promise<net.Server> {
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      // 1回の受信に複数のコマンドが入るので、コマンド名ごとに応答する
      for (const [, name] of chunk.toString().matchAll(/\*\d+\r\n\$\d+\r\n(\w+)/g)) {
        const command = name?.toUpperCase();
        if (command === 'HELLO') {
          // RESP3 を断ると ioredis は RESP2 で続ける
          socket.write("-ERR unknown command 'hello'\r\n");
        } else if (command === 'INFO') {
          const body = 'loading:0\r\n';
          socket.write(`$${body.length}\r\n${body}\r\n`);
        } else if (command === 'CLIENT') {
          socket.write('+OK\r\n');
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let server: net.Server;
let cache: typeof import('./client').cache;

beforeEach(async () => {
  server = await startUnresponsiveRedis();
  vi.stubEnv('REDIS_URL', `redis://127.0.0.1:${(server.address() as AddressInfo).port}`);
  // cache は globalThis に使い回されるので、テストごとに作り直す
  delete (globalThis as { cacheClient?: unknown }).cacheClient;
  vi.resetModules();
  ({ cache } = await import('./client'));
  await vi.waitFor(() => expect(cache.isAvailable()).toBe(true));
});

afterEach(() => {
  cache.disconnect();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  server.close();
  vi.unstubAllEnvs();
});

/** 返らなければ 'pending' になる。テスト自体を待たせ続けないための上限 */
const GIVE_UP_MS = 3000;
function settleWithin<T>(promise: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([
    promise,
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), GIVE_UP_MS)),
  ]);
}

describe('接続は保ったまま Redis が応答しないとき', () => {
  it('increment は設定時間内に null で返る', async () => {
    await expect(settleWithin(cache.increment('test:counter', 60))).resolves.toBeNull();
  });

  it('get は設定時間内にミスで返る', async () => {
    await expect(settleWithin(cache.get('test:key'))).resolves.toEqual({ hit: false });
  });
});
