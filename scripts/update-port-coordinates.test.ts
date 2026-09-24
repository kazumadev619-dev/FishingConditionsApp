import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// スクリプトは import した時点で main() を流すので、DB と外部 API を差し替えてから import する。
// main() は最後に pool.end() を呼ぶので、それを終了の合図にする
const findMany = vi.fn();
const update = vi.fn();
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
    $disconnect = vi.fn();
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

function stubFetch(ok: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 503,
      json: async () => ({
        status: 1,
        tide: { port: { latitude: 35.4, longitude: 139.45 } },
      }),
    })),
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

describe('update-port-coordinates の終了コード（#208）', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    findMany.mockResolvedValue(ports);
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    update.mockReset();
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

  it('外部 API の失敗だけなら 0 のまま終わる', async () => {
    stubFetch(false);
    expect(await run()).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});
