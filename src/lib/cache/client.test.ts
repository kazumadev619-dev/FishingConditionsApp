import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => {
  // cache はモジュール読み込み時に生成されるので、import より前に REDIS_URL を置く
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  return {
    status: 'ready',
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    scanStream: vi.fn(),
    multi: vi.fn(),
    disconnect: vi.fn(),
    constructed: vi.fn(),
    handlers: {} as Record<string, (arg?: unknown) => void>,
  };
});
const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('ioredis', () => ({
  default: class {
    constructor(url: string, options: unknown) {
      redisMock.constructed(url, options);
    }
    get status() {
      return redisMock.status;
    }
    get = redisMock.get;
    set = redisMock.set;
    del = redisMock.del;
    scanStream = redisMock.scanStream;
    on = (event: string, handler: (arg?: unknown) => void) => {
      redisMock.handlers[event] = handler;
    };
    multi = redisMock.multi;
    disconnect = redisMock.disconnect;
  },
}));
vi.mock('../logger', () => ({ logger: loggerMock }));

import { cache } from './client';

const redisOptions = redisMock.constructed.mock.calls[0]?.[1] as {
  retryStrategy: (times: number) => number | null;
};

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.status = 'ready';
});

// cache はテスト間で共有で、コマンド失敗のログは5分に1回に間引かれる。
// 呼ぶたびに前回より5分以上進めた偽の時計にして、そのテストの最初の失敗が必ず error になるようにする
const COMMAND_LOG_INTERVAL_MS = 5 * 60 * 1000;
let commandClock = Date.now();
function startCommandLogClock() {
  commandClock = Math.max(commandClock, Date.now()) + COMMAND_LOG_INTERVAL_MS + 1;
  vi.useFakeTimers({ now: commandClock });
}
afterEach(() => {
  // 偽の時計が進んだ分を持ち越して、次のテストが時間を巻き戻さないようにする
  if (vi.isFakeTimers()) commandClock = Math.max(commandClock, Date.now());
  vi.useRealTimers();
});

describe('CacheClient.get', () => {
  it('Date を含む値は JSON 往復後の型で返す', async () => {
    redisMock.get.mockResolvedValue('{"observedAt":"2026-10-11T00:00:00.000Z"}');

    const result = await cache.get<{ observedAt: Date }>('test:key');

    expect(result).toEqual({ hit: true, value: { observedAt: '2026-10-11T00:00:00.000Z' } });
    if (result.hit) {
      expectTypeOf(result.value.observedAt).toEqualTypeOf<string>();
    }
  });

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

describe('CacheClient.set', () => {
  it('JSON にならない undefined は書かずに false を返す', async () => {
    await expect(cache.set('test:key', undefined, 60)).resolves.toBe(false);

    expect(redisMock.set).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { key: 'test:key' },
      'Skipped caching a value that JSON cannot represent',
    );
  });

  it('null は JSON にして TTL 付きで書く', async () => {
    redisMock.set.mockResolvedValue('OK');

    await expect(cache.set('test:key', null, 60)).resolves.toBe(true);
    expect(redisMock.set).toHaveBeenCalledWith('test:key', 'null', 'EX', 60);
  });
});

describe('CacheClient.increment', () => {
  const givenTransaction = (results: unknown) => {
    const transaction = { set: vi.fn(), incr: vi.fn(), exec: vi.fn(async () => results) };
    transaction.set.mockReturnValue(transaction);
    transaction.incr.mockReturnValue(transaction);
    redisMock.multi.mockReturnValue(transaction);
    return transaction;
  };

  it('TTL を付けてから増やし、増やした後の値を返す', async () => {
    const transaction = givenTransaction([
      [null, 'OK'],
      [null, 3],
    ]);

    await expect(cache.increment('k', 60)).resolves.toBe(3);
    expect(transaction.set).toHaveBeenCalledWith('k', 0, 'EX', 60, 'NX');
  });

  it('Redis のエラーは null にしてログに残す', async () => {
    startCommandLogClock();
    givenTransaction([
      [null, 'OK'],
      [new Error('boom'), null],
    ]);

    await expect(cache.increment('k', 60)).resolves.toBeNull();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it('接続できないときは null を返す', async () => {
    redisMock.status = 'end';

    await expect(cache.increment('k', 60)).resolves.toBeNull();
    expect(redisMock.multi).not.toHaveBeenCalled();
  });
});

describe('Redis に届かないときのログ', () => {
  const INTERVAL_MS = 5 * 60 * 1000;
  const connectionRefused = new Error('connect ECONNREFUSED');
  // 上限なくリトライする間の1日分。5秒おきに error と reconnecting が1回ずつ来る
  const failOneDay = () => {
    for (let elapsed = 0; elapsed < 24 * 60 * 60 * 1000; elapsed += 5000) {
      vi.advanceTimersByTime(5000);
      redisMock.handlers.error?.(connectionRefused);
      redisMock.handlers.reconnecting?.(5000);
    }
  };

  // cache はテスト間で共有なので、最後に記録した時刻より前に時計を戻さない
  let now = Date.now();

  beforeEach(() => {
    vi.useFakeTimers({ now });
    redisMock.handlers.ready?.();
    vi.clearAllMocks();
  });

  afterEach(() => {
    now = Date.now() + INTERVAL_MS;
    vi.useRealTimers();
  });

  it('切断の最初のエラーはすぐ error で残す', () => {
    redisMock.handlers.error?.(connectionRefused);

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.error).toHaveBeenCalledWith(
      { err: connectionRefused, failedAttempts: 1 },
      'Redis client error',
    );
  });

  it('切断が続いても error は5分に1行に間引く', () => {
    failOneDay();

    expect(loggerMock.error).toHaveBeenCalledTimes(288);
  });

  it('間引いて記録する行に、そこまでの失敗回数を載せる', () => {
    redisMock.handlers.error?.(connectionRefused);
    for (let attempt = 0; attempt < 60; attempt++) {
      vi.advanceTimersByTime(5000);
      redisMock.handlers.error?.(connectionRefused);
    }

    expect(loggerMock.error).toHaveBeenLastCalledWith(
      { err: connectionRefused, failedAttempts: 61 },
      'Redis client error',
    );
  });

  it('再接続の試行は debug に落とし、warn では出さない', () => {
    failOneDay();

    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.debug).toHaveBeenCalledWith({ delay: 5000 }, 'Redis client reconnecting');
  });

  it('復旧したら失敗回数を残して数え直す', () => {
    redisMock.handlers.error?.(connectionRefused);
    redisMock.handlers.error?.(connectionRefused);

    redisMock.handlers.ready?.();
    expect(loggerMock.info).toHaveBeenCalledWith({ failedAttempts: 2 }, 'Redis client ready');

    vi.advanceTimersByTime(INTERVAL_MS);
    redisMock.handlers.error?.(connectionRefused);
    expect(loggerMock.error).toHaveBeenLastCalledWith(
      { err: connectionRefused, failedAttempts: 1 },
      'Redis client error',
    );
  });

  it('接続と切断を繰り返しても error は5分に1行に収まる', () => {
    for (let flap = 0; flap < 100; flap++) {
      vi.advanceTimersByTime(1000);
      redisMock.handlers.error?.(connectionRefused);
      redisMock.handlers.ready?.();
    }

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });

  it('何回失敗しても再接続を諦めず、接続も閉じない', () => {
    failOneDay();

    expect(redisOptions.retryStrategy(1_000_000)).toBe(5000);
    expect(redisMock.disconnect).not.toHaveBeenCalled();
  });
});

// 接続エラーのログ（上の describe）と時計を共有するので、その後ろに置く。
describe('Redis が応答しないときのコマンド失敗のログ', () => {
  const timeout = new Error('Command timed out');

  beforeEach(() => {
    startCommandLogClock();
    redisMock.get.mockRejectedValue(timeout);
    redisMock.set.mockRejectedValue(timeout);
  });

  it('最初の失敗は key とエラーごと error で残す', async () => {
    await cache.get('weather:1');

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.error).toHaveBeenCalledWith(
      { key: 'weather:1', error: timeout },
      'Failed to get cached data',
    );
  });

  it('続く失敗は error にせず debug に落とす', async () => {
    await cache.get('weather:1');
    await cache.get('weather:2');
    await cache.set('weather:3', { a: 1 }, 60);

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.debug).toHaveBeenCalledWith(
      { key: 'weather:2', error: timeout },
      'Failed to get cached data',
    );
    expect(loggerMock.debug).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['get', () => cache.get('k'), 'Failed to get cached data'],
    ['set', () => cache.set('k', { a: 1 }, 60), 'Failed to set cache data'],
    ['increment', () => cache.increment('k', 60), 'Failed to increment counter'],
    ['delete', () => cache.delete('k'), 'Failed to delete cache data'],
    [
      'deleteByPattern',
      () => cache.deleteByPattern('w:*'),
      'Failed to delete cache data by pattern',
    ],
  ])('%s の失敗も間引く（最初の1回だけ error）', async (_name, run, message) => {
    redisMock.del.mockRejectedValue(timeout);
    redisMock.scanStream.mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(timeout) }),
    }));
    redisMock.multi.mockReturnValue({
      set: () => ({ incr: () => ({ exec: () => Promise.reject(timeout) }) }),
    });

    await run();
    await run();

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.error).toHaveBeenCalledWith(expect.anything(), message);
    expect(loggerMock.debug).toHaveBeenCalledTimes(1);
  });

  it('1日黙り続けても、error は5分に1行に収まる', async () => {
    for (let elapsed = 0; elapsed < 24 * 60 * 60 * 1000; elapsed += 5000) {
      await cache.get('weather:1');
      vi.advanceTimersByTime(5000);
    }

    expect(loggerMock.error).toHaveBeenCalledTimes(288);
  });

  it('5分たったら、次の失敗はまた error で残す', async () => {
    await cache.get('weather:1');
    vi.advanceTimersByTime(COMMAND_LOG_INTERVAL_MS);
    await cache.get('weather:2');

    expect(loggerMock.error).toHaveBeenCalledTimes(2);
  });

  it('接続エラーを出した直後でも、最初のコマンド失敗は error で残す', async () => {
    redisMock.handlers.error?.(new Error('connect ECONNREFUSED'));
    await cache.get('weather:1');

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'weather:1' }),
      'Failed to get cached data',
    );
  });
});

describe('CacheClient.disconnect', () => {
  it('接続を閉じる', () => {
    cache.disconnect();

    expect(redisMock.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('シングルトン', () => {
  afterEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });

  it.each(['development', 'production'])(
    'モジュールを評価し直しても %s で接続を増やさない',
    async (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      // ファイル先頭の import が残した共有を消して、この NODE_ENV での評価から始める
      Reflect.deleteProperty(globalThis, 'cacheClient');
      vi.resetModules();
      const first = await import('./client');
      vi.resetModules();

      const reevaluated = await import('./client');

      expect(reevaluated.cache).toBe(first.cache);
      expect(redisMock.constructed).toHaveBeenCalledTimes(1);
    },
  );
});
