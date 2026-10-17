import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => {
  // cache はモジュール読み込み時に生成されるので、import より前に REDIS_URL を置く
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  return { status: 'ready', get: vi.fn(), on: vi.fn() };
});
const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));

vi.mock('ioredis', () => ({
  default: class {
    get status() {
      return redisMock.status;
    }
    get = redisMock.get;
    on = redisMock.on;
  },
}));
vi.mock('../logger', () => ({ logger: loggerMock }));

import { cache } from './client';

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.status = 'ready';
});

describe('CacheClient.get', () => {
  it('キーが無いときはミスを返す', async () => {
    redisMock.get.mockResolvedValue(null);

    await expect(cache.get('test:key')).resolves.toEqual({ hit: false });
  });

  it('保存済みの null はヒットとして返す', async () => {
    redisMock.get.mockResolvedValue('null');

    await expect(cache.get('test:key')).resolves.toEqual({ hit: true, value: null });
  });

  it('parse できない値はミスを返しエラーを記録する', async () => {
    redisMock.get.mockResolvedValue('{x');

    await expect(cache.get('test:key')).resolves.toEqual({ hit: false });
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'test:key' }),
      'Failed to parse cached data',
    );
  });

  it('Redis の get が失敗したときはミスを返す', async () => {
    redisMock.get.mockRejectedValue(new Error('connection lost'));

    await expect(cache.get('test:key')).resolves.toEqual({ hit: false });
  });

  it('Redis が ready でないときは get を呼ばずにミスを返す', async () => {
    redisMock.status = 'reconnecting';

    await expect(cache.get('test:key')).resolves.toEqual({ hit: false });
    expect(redisMock.get).not.toHaveBeenCalled();
  });
});
