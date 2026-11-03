import { logger } from './logger';

/**
 * ハンドラの処理時間を計測し、Server-Timing ヘッダとしてレスポンスに載せる Route Handler を返す。
 *
 * Stage 2 / Stage 6 の性能計測で「アプリ内部の処理時間」と
 * 「エンドツーエンドのレイテンシ」を同一リクエストから取得するために使う。
 * Go バックエンドも同じヘッダ名で出すことで、比較がネットワーク条件から独立する。
 *
 * ## 計測対象を増やす手順
 * ルートの `GET` をこれで包むだけ（1 行）。`GET` を別名に改名する必要はない。
 *
 *     export const GET = withServerTiming('weather', (request: NextRequest) =>
 *       withUserRateLimit('weather', () => handleGet(request)),
 *     );
 *
 * ## 計測値の読み方
 * - 範囲: ハンドラ全体。`withUserRateLimit` の判定時間と、その 401 / 429 応答も含む。
 * - キャッシュ: 応答は `Cache-Control: public, max-age=...` で保存されうる。
 *   保存済み応答は、キャッシュミス時に測った `dur` をそのまま再生する。
 *   Cloudflare は `/api/` を Bypass 済みなので残るのはブラウザと中間キャッシュ。
 *   計測は k6 などキャッシュしないクライアントで行い、DevTools の値は鵜呑みにしない。
 * - 例外: ハンドラが throw すると Next が独自の 500 を返すためヘッダは付かない。
 *   代わりに `metric` と `durationMs` を warn ログに残す。
 *
 * @param metric Server-Timing のメトリクス名（例: 'weather'）
 * @param handler 実際のリクエストハンドラ。受け取った引数（request, context）はそのまま渡す
 */
export function withServerTiming<A extends unknown[], T extends Response>(
  metric: string,
  handler: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return async (...args) => {
    const start = performance.now();
    let response: T;

    try {
      response = await handler(...args);
    } catch (error) {
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
  };
}
