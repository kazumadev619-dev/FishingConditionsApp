import { afterEach, describe, expect, it, vi } from 'vitest';

const startTelemetry = vi.hoisted(() => vi.fn());
vi.mock('./lib/telemetry/sdk', () => ({ startTelemetry }));

import { register } from './instrumentation';

// 期待値は issue #283 の「着手前の決定（2026-11-27）」と依頼から決める。
// 送り先（OTEL_EXPORTER_OTLP_ENDPOINT）が未設定の環境（ローカル、テスト、CI）では SDK を起動しない。
afterEach(() => {
  vi.unstubAllEnvs();
  startTelemetry.mockReset();
});

describe('register', () => {
  it('Node の実行環境で送り先があれば、SDK を起動する', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://alloy.test:4318');

    await register();

    expect(startTelemetry).toHaveBeenCalled();
  });

  it('送り先が無ければ起動しない', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');

    await register();

    expect(startTelemetry).not.toHaveBeenCalled();
  });

  it('Edge の実行環境では起動しない', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://alloy.test:4318');

    await register();

    expect(startTelemetry).not.toHaveBeenCalled();
  });
});
