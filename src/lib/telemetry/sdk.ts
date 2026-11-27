import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';

const withoutQuery = (value: string) => value.split('?')[0] as string;

// プローブ（10秒おき）のスパンは送らない（#283）。子のスパンも親に従って落ちる。
const EXCLUDED_PATHS = ['/healthz', '/readyz'];

const excludeHealthChecks: Sampler = {
  shouldSample(_context, _traceId, _name, _kind, attributes) {
    // Next の handleRequest のスパンは、開始時に http.target（パス + クエリ）を持つ
    const path = withoutQuery(String(attributes['http.target'] ?? ''));
    return {
      decision: EXCLUDED_PATHS.includes(path)
        ? SamplingDecision.NOT_RECORD
        : SamplingDecision.RECORD_AND_SAMPLED,
    };
  },
  toString: () => 'ExcludeHealthChecks',
};

// トレースは 100% 送る（ADR-005）。外から来た traceparent の sampled フラグには従わない。
export const sampler = new ParentBasedSampler({
  root: excludeHealthChecks,
  remoteParentSampled: excludeHealthChecks,
  remoteParentNotSampled: excludeHealthChecks,
});

/**
 * URL のクエリを送らない。上流の URL には API キー（appid・key）が、受けた要求には
 * メール確認のトークンなどが入る。Next は開始時に名前（`fetch GET <url>`）と属性
 * （http.url・http.target・next.span_name）を付けるので、onStart で消せば足りる。
 * 属性は名前で決め打ちしない（next.span_name のように、URL を持つものが後から増えうる）。
 */
export const stripUrlQuery: SpanProcessor = {
  onStart(span) {
    for (const [key, value] of Object.entries(span.attributes)) {
      if (typeof value === 'string' && value.includes('?')) {
        span.setAttribute(key, withoutQuery(value));
      }
    }
    if (span.name.includes('?')) span.updateName(withoutQuery(span.name));
  },
  onEnd() {},
  forceFlush: async () => {},
  shutdown: async () => {},
};

/**
 * 送り先などは OTEL_* の環境変数で決まる（OTEL_EXPORTER_OTLP_ENDPOINT など。k8s/config.env）。
 * メトリクスの送り方も環境変数から（既定は OTLP、60 秒ごと）。
 */
export function startTelemetry(): void {
  // ponytail: SIGTERM で shutdown しないので、Pod の入れ替えで最後の数秒のスパンと最大60秒のメトリクスを落とす。困ったら終了時に sdk.shutdown() を呼ぶ
  new NodeSDK({
    serviceName: 'fishing-conditions-app',
    sampler,
    spanProcessors: [stripUrlQuery, new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })],
  }).start();
}
