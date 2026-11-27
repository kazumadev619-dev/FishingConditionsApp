import { type Counter, type Histogram, metrics } from '@opentelemetry/api';

// 名前とラベルは PR（#283 の1本目）の本文に一覧がある。ラベルにスポット（港コードなど）を入れない。
// metrics の API にはプロキシが無く、SDK の起動前に作った計器は no-op のまま残る。最初の記録のときに作る。
let instruments: { upstreamDuration: Histogram; cacheLookups: Counter } | undefined;

function get() {
  if (!instruments) {
    const meter = metrics.getMeter('fishing-conditions-app');
    instruments = {
      upstreamDuration: meter.createHistogram('fishing.upstream.request.duration', {
        description: '外部 API への HTTP 1回ごとの所要時間（リトライも1回ずつ）',
        unit: 's',
        // 上流の実測は 35〜93ms、タイムアウトは 10 秒（docs/perf/2026-11-22-api-baseline.md）
        advice: { explicitBucketBoundaries: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
      }),
      cacheLookups: meter.createCounter('fishing.cache.lookups', {
        description: 'Redis のキャッシュを引いた回数（hit / miss）',
      }),
    };
  }
  return instruments;
}

/** errorType が無ければ成功。 */
export function recordUpstreamRequest(host: string, seconds: number, errorType?: string): void {
  get().upstreamDuration.record(seconds, {
    'server.address': host,
    ...(errorType && { 'error.type': errorType }),
  });
}

/** prefix はキャッシュキーの先頭（weather・tide・location・score）。 */
export function recordCacheLookup(prefix: string, hit: boolean): void {
  get().cacheLookups.add(1, { 'cache.prefix': prefix, 'cache.result': hit ? 'hit' : 'miss' });
}
