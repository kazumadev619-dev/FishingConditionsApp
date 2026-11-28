import { context, INVALID_SPAN_CONTEXT, TraceFlags, trace } from '@opentelemetry/api';
import { StackContextManager } from '@opentelemetry/sdk-trace';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

// 期待値は issue #283 の「着手前の決定（2026-11-27）」から決める。Loki のログから Tempo のトレースへ辿れるように、
// 有効なスパンの中で出したログには trace_id と span_id を載せる。キー名は OTel のログの仕様に合わせる。
describe('logger の trace_id（#283）', () => {
  const spanContext = {
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId: 'b7ad6b7169203331',
    traceFlags: TraceFlags.SAMPLED,
  };

  beforeAll(() => {
    context.setGlobalContextManager(new StackContextManager().enable());
  });
  afterAll(() => {
    context.disable();
  });

  it('スパンの中では trace_id と span_id を載せる', () => {
    const out = context.with(trace.setSpanContext(context.active(), spanContext), () =>
      captureLine((l) => l.info('hello')),
    );
    expect(out).toMatchObject({ trace_id: spanContext.traceId, span_id: spanContext.spanId });
  });

  // SDK が動いていないと、Next のスパンは中身が 0 の無効な ID になる。それを載せない
  it('無効なスパン（ID が 0）では載せない', () => {
    const out = context.with(trace.setSpanContext(context.active(), INVALID_SPAN_CONTEXT), () =>
      captureLine((l) => l.info('hello')),
    );
    expect(out).not.toHaveProperty('trace_id');
  });

  it('スパンの外では載せない', () => {
    const out = captureLine((l) => l.info('hello'));
    expect(out).not.toHaveProperty('trace_id');
    expect(out).not.toHaveProperty('span_id');
  });
});
