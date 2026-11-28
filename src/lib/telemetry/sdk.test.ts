import { context, SpanKind, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// startTelemetry の配線だけを見るため、NodeSDK は渡された設定を記録するだけにする（外へ送らせない）
const nodeSdk = vi.hoisted(() => ({ configs: [] as unknown[] }));
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    constructor(config: unknown) {
      nodeSdk.configs.push(config);
    }
    start() {}
  },
}));

import { sampler, startTelemetry, stripUrlQuery } from './sdk';

// 期待値は issue #283 の「着手前の決定（2026-11-27）」から決める。
// /healthz と /readyz は計測から外す。上流の URL のクエリには API キーが入るので送らない。
// span の名前と属性は、Next 16 が付けるもの（base-server の handleRequest、patch-fetch の fetch）に合わせる。
const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({
  sampler,
  spanProcessors: [stripUrlQuery, new SimpleSpanProcessor({ exporter })],
});
const tracer = provider.getTracer('test');

beforeAll(() => {
  context.setGlobalContextManager(new StackContextManager().enable());
});

afterAll(() => {
  context.disable();
});

beforeEach(() => exporter.reset());

// SimpleSpanProcessor の書き出しは非同期なので、待ってから読む
async function finished() {
  await provider.forceFlush();
  return exporter.getFinishedSpans();
}

function request(target: string, child?: () => void) {
  tracer.startActiveSpan(
    'GET',
    { kind: SpanKind.SERVER, attributes: { 'http.method': 'GET', 'http.target': target } },
    (span) => {
      child?.();
      span.end();
    },
  );
}

describe('ヘルスチェックを計測から外す', () => {
  it.each(['/healthz', '/readyz', '/healthz?probe=1'])('%s のスパンは送らない', async (target) => {
    request(target, () => tracer.startSpan('render route (app) /healthz').end());
    expect(await finished()).toEqual([]);
  });

  it.each(['/dashboard', '/api/scores', '/healthzz'])('%s のスパンは送る', async (target) => {
    request(target, () => tracer.startSpan('child').end());
    expect((await finished()).map((s) => s.name)).toEqual(['child', 'GET']);
  });

  it('外から来た traceparent の sampled=0 に従わず、100% 送る', async () => {
    const remote = trace.setSpanContext(context.active(), {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: 0,
      isRemote: true,
    });
    context.with(remote, () => request('/dashboard'));
    expect(await finished()).toHaveLength(1);
  });
});

describe('URL のクエリを送らない', () => {
  it('fetch のスパンの名前と属性からクエリ（API キー）を消す', async () => {
    const url = 'https://api.openweathermap.org/data/2.5/weather?lat=35&lon=139&appid=SECRET';
    tracer
      .startSpan(`fetch GET ${url}`, {
        kind: SpanKind.CLIENT,
        // next.span_name は Next の tracer が付ける（standalone のビルドで、ここに URL が残るのを実測した）
        attributes: { 'http.url': url, 'http.method': 'GET', 'next.span_name': `fetch GET ${url}` },
      })
      .end();

    const [span] = await finished();
    expect(span?.name).toBe('fetch GET https://api.openweathermap.org/data/2.5/weather');
    expect(span?.attributes['http.url']).toBe('https://api.openweathermap.org/data/2.5/weather');
    expect(JSON.stringify(span?.attributes)).not.toContain('SECRET');
  });

  it('受けた要求の http.target からクエリ（メール確認のトークンなど）を消す', async () => {
    request('/auth/verify-email?token=SECRET');
    const [span] = await finished();
    expect(span?.attributes['http.target']).toBe('/auth/verify-email');
  });
});

// API キーを外に出さない処理と、ヘルスチェックを外す処理は、SDK に渡して初めて効く
describe('startTelemetry', () => {
  it('SDK に sampler と、クエリを消す処理を渡す', () => {
    startTelemetry();

    expect(nodeSdk.configs).toHaveLength(1);
    const config = nodeSdk.configs[0] as { sampler: unknown; spanProcessors: unknown[] };
    expect(config.sampler).toBe(sampler);
    expect(config.spanProcessors).toContain(stripUrlQuery);
  });
});
