import { logger } from './logger';

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
  let response: T;

  try {
    response = await handler();
  } catch (error) {
    // 未捕捉例外では Next が独自の 500 を返すため、ヘッダを載せる先が無い。
    // 何もしないと「最も遅いリクエスト」だけが計測から系統的に抜け落ち、
    // Stage 2 のベースラインが実際より速く出るため、ログには必ず残す。
    logger.warn(
      { metric, durationMs: performance.now() - start },
      'Handler threw before responding; Server-Timing could not be attached',
    );
    throw error;
  }

  const durationMs = (performance.now() - start).toFixed(1);
  // Server-Timing はカンマ区切りの複数メトリクスを取れる仕様。
  // set() だとハンドラ側が付けた値を潰すため append する。
  response.headers.append('Server-Timing', `${metric};dur=${durationMs}`);
  return response;
}
