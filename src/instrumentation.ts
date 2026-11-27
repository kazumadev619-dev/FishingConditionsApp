// Next がサーバーの起動時に1回呼ぶ。OpenTelemetry の SDK を起動し、トレースとメトリクスを
// OTLP で Alloy に送る（#283、ADR-005）。
export async function register(): Promise<void> {
  // 送り先が無い環境（ローカル、テスト、CI）では起動しない。起動すると既定の localhost:4318 へ送り続ける
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  // Edge 用のバンドルに Node 専用の SDK を入れないよう、動的に読む
  const { startTelemetry } = await import('./lib/telemetry/sdk');
  startTelemetry();
}
