import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logger';

// 本物の logger は開発時 pino-pretty の transport（別スレッド）に書くので、
// 同じ設定で出力先だけ差し替えて JSON を取り出す
function captureLine(log: (l: pino.Logger) => void): Record<string, unknown> {
  const lines: string[] = [];
  log(pino({ ...loggerOptions, transport: undefined }, { write: (s: string) => lines.push(s) }));
  return JSON.parse(lines[0] ?? '');
}

describe('logger の error キー（#294）', () => {
  it('Error を渡すと message と stack が残る', () => {
    const out = captureLine((l) => l.error({ error: new Error('boom') }, 'failed'));
    expect(out.error).toMatchObject({ type: 'Error', message: 'boom' });
    expect((out.error as { stack: string }).stack).toContain('Error: boom');
  });

  it('Error でない値はそのまま残る', () => {
    const out = captureLine((l) => l.error({ error: 'plain' }, 'failed'));
    expect(out.error).toBe('plain');
  });
});
