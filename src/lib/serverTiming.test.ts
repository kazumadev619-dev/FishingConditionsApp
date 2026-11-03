import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { withServerTiming } from './serverTiming';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe('withServerTiming', () => {
  it('受け取った引数をそのままハンドラに渡す', async () => {
    const handler = vi.fn(
      async (...args: [string, { id: number }]) => new Response(String(args.length)),
    );

    await withServerTiming('m', handler)('req', { id: 1 });

    expect(handler).toHaveBeenCalledWith('req', { id: 1 });
  });

  it('Server-Timing: <metric>;dur=<数値> を付け、本文はそのまま返す', async () => {
    const response = await withServerTiming('weather', async () => new Response('body'))();

    expect(response.headers.get('Server-Timing')).toMatch(/^weather;dur=\d+\.\d$/);
    await expect(response.text()).resolves.toBe('body');
  });

  it('ハンドラが付けた Server-Timing を潰さず追記する', async () => {
    const handler = async () => new Response('ok', { headers: { 'Server-Timing': 'db;dur=1.0' } });

    const response = await withServerTiming('weather', handler)();

    expect(response.headers.get('Server-Timing')).toMatch(/^db;dur=1\.0, weather;dur=\d+\.\d$/);
  });

  it('ハンドラが throw したら同じ例外を伝え、metric と durationMs をログに残す', async () => {
    const boom = new Error('boom');

    await expect(
      withServerTiming('tide', async () => {
        throw boom;
      })(),
    ).rejects.toBe(boom);

    expect(logger.warn).toHaveBeenCalledWith(
      { metric: 'tide', durationMs: expect.any(Number) },
      expect.any(String),
    );
  });
});
