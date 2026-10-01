import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// スクリプトは import した時点で main() を流すので、DB と外部 API を差し替えてから import する。
// main() は最後に pool.end() を呼ぶので、それを終了の合図にする
const findMany = vi.fn();
const update = vi.fn();
const disconnect = vi.fn();
let finished: () => void = () => {};

vi.mock('pg', () => ({
  default: {
    Pool: class {
      end = async () => finished();
    },
  },
}));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));
vi.mock('../src/generated/prisma/client', () => ({
  PrismaClient: class {
    ports = { findMany, update };
    $disconnect = disconnect;
  },
}));

const ports = [
  {
    id: 'a',
    name: '港A',
    prefecture_code: '13',
    port_code: '1',
    latitude: null,
    longitude: null,
  },
  {
    id: 'b',
    name: '港B',
    prefecture_code: '13',
    port_code: '2',
    latitude: null,
    longitude: null,
  },
];

// 引数は港ごとの成否。足りない分は最後の値を使う
function stubFetch(...oks: boolean[]) {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const ok = oks[Math.min(call++, oks.length - 1)];
      return {
        ok,
        status: ok ? 200 : 503,
        json: async () => ({
          status: 1,
          tide: { port: { latitude: 35.4, longitude: 139.45 } },
        }),
      };
    }),
  );
}

async function run() {
  vi.resetModules();
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await import('./update-port-coordinates');
  await done;
  return process.exitCode;
}

const argv = process.argv;

describe('update-port-coordinates の終了コード（#208, #218）', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    findMany.mockResolvedValue(ports);
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    update.mockReset();
    disconnect.mockReset();
  });

  it('DB 更新が1件でも失敗したら 1 で終わる', async () => {
    stubFetch(true);
    update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('permission denied for table ports'));
    expect(await run()).toBe(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('全件成功したら 0 のまま終わる', async () => {
    stubFetch(true);
    update.mockResolvedValue({});
    expect(await run()).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('外部 API の失敗が一部だけなら 0 のまま終わる', async () => {
    stubFetch(false, true);
    update.mockResolvedValue({});
    expect(await run()).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('外部 API が全港で失敗したら 1 で終わる（#218）', async () => {
    stubFetch(false);
    expect(await run()).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('--dry-run でも全港で失敗したら 1 で終わる（#218）', async () => {
    process.argv = [...argv, '--dry-run'];
    stubFetch(false);
    expect(await run()).toBe(1);
  });

  it('対象の港が0件なら 0 のまま終わる（#218）', async () => {
    findMany.mockResolvedValue([]);
    expect(await run()).toBeUndefined();
  });

  // run() は pool.end() を待つので、後片付けが走らなければタイムアウトで落ちる
  it('致命的なエラーでも 1 で終わり、接続を閉じる（#218）', async () => {
    findMany.mockRejectedValue(new Error('connection refused'));
    expect(await run()).toBe(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
