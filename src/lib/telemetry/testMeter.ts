import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  type DataPoint,
  type Histogram,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeAll, beforeEach } from 'vitest';

// テスト専用。差分（DELTA）で読むので、collect のたびに前回からの分だけが返る
class TestReader extends MetricReader {
  constructor() {
    super({ aggregationTemporalitySelector: () => AggregationTemporality.DELTA });
  }
  protected async onShutdown() {}
  protected async onForceFlush() {}
}

export interface Point {
  attributes: Record<string, unknown>;
  /** カウンターは合計、ヒストグラムは件数 */
  value: number;
}

/**
 * グローバルの MeterProvider をインメモリの reader に差し替え、指定したメトリクスの
 * 各テストで記録された点を読む関数を返す。
 */
export function setupTestMeter(): (name: string) => Promise<Point[]> {
  const reader = new TestReader();

  const read = async (name: string): Promise<Point[]> => {
    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === name);
    const points = (metric?.dataPoints ?? []) as DataPoint<number | Histogram>[];
    return points.map((p) => ({
      attributes: { ...p.attributes },
      value: typeof p.value === 'number' ? p.value : p.value.count,
    }));
  };

  beforeAll(() => {
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  });
  beforeEach(async () => {
    await reader.collect();
  });
  afterAll(() => {
    metrics.disable();
  });

  return read;
}
