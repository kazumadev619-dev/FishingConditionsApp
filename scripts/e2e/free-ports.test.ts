// 期待値の出どころ: #438 と ADR-012。worktree ごとに分けたアプリが、別の worktree のアプリと
// 同じポートを選ばない。macOS では `next start -H localhost` が [::1] だけで待ち受けるので、
// 127.0.0.1 だけで空きを確かめると、使用中のポートを空きと見なす。
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { isFree, pickFreePorts } from './free-ports.mjs';

function listen(host: string): Promise<{ port: number; close: () => Promise<void> } | null> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(null)); // この環境にその待ち受け先が無い（IPv6 なしなど）
    s.listen(0, host, () => {
      const { port } = s.address() as net.AddressInfo;
      resolve({ port, close: () => new Promise((r) => s.close(() => r())) });
    });
  });
}

describe('isFree', () => {
  it('[::1] だけで待ち受けているポートは、空きではない', async () => {
    const holder = await listen('::1');
    if (!holder) return; // IPv6 が無い環境では、この状況が起きない
    try {
      expect(await isFree(holder.port)).toBe(false);
    } finally {
      await holder.close();
    }
  });

  it('127.0.0.1 だけで待ち受けているポートは、空きではない', async () => {
    const holder = await listen('127.0.0.1');
    expect(holder).not.toBeNull();
    try {
      expect(await isFree(holder!.port)).toBe(false);
    } finally {
      await holder!.close();
    }
  });

  it('誰も使っていないポートは空き', async () => {
    const holder = await listen('127.0.0.1');
    const port = holder!.port;
    await holder!.close();
    expect(await isFree(port)).toBe(true);
  });
});

describe('pickFreePorts', () => {
  it('重ならない n 個を返す', async () => {
    const ports = await pickFreePorts(3);
    expect(new Set(ports).size).toBe(3);
  });
});
