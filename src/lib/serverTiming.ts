/**
 * ハンドラの処理時間を計測し、Server-Timing ヘッダとしてレスポンスに載せる。
 *
 * Stage 2 / Stage 6 の性能計測で「アプリ内部の処理時間」と
 * 「エンドツーエンドのレイテンシ」を同一リクエストから取得するために使う。
 * Go バックエンドも同じヘッダ名で出すことで、比較がネットワーク条件から独立する。
 *
 * @param metric Server-Timing のメトリクス名（例: 'weather'）
 * @param handler 実際のリクエストハンドラ
 */
export async function withServerTiming<T extends Response>(
  metric: string,
  handler: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  const response = await handler();
  const durationMs = (performance.now() - start).toFixed(1);
  response.headers.set('Server-Timing', `${metric};dur=${durationMs}`);
  return response;
}
