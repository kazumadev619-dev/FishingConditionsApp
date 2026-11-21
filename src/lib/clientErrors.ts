/**
 * ブラウザで起きた例外を、サーバーのログへ届ける（#247）。
 *
 * ブラウザの `@/lib/logger` は console に出すだけで、サーバーには届かない。
 * 受け口は POST /api/client-errors。ログイン中の利用者だけが送れる（`/api/*` は既定で認証が要る）。
 * 未ログインのページ（/login など）で起きた例外は届かない。
 */

export const CLIENT_ERROR_ENDPOINT = '/api/client-errors';

export const CLIENT_ERROR_SOURCES = [
  'dashboard-error',
  'map-boundary',
  'window-error',
  'unhandled-rejection',
] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

/** 受け口が受け付ける長さ。ログを溢れさせないため、受け口は超えた分を切らず拒否する */
export const CLIENT_ERROR_LIMITS = {
  message: 500,
  name: 100,
  stack: 4000,
  componentStack: 2000,
  digest: 100,
  path: 200,
  /** 本文全体。日本語の文字は UTF-8 で 3 バイトになるので、各項目の合計より余裕を持たせる */
  bodyBytes: 16 * 1024,
} as const;

/** 描画の繰り返しなどで同じ例外が連続しても、1 回のページ表示で送る数を抑える */
const MAX_REPORTS_PER_PAGE_LOAD = 5;
let reportedCount = 0;

const clip = (value: string, max: number) => value.slice(0, max);

export function reportClientError(
  error: unknown,
  source: ClientErrorSource,
  componentStack?: string | null,
): void {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  if (reportedCount >= MAX_REPORTS_PER_PAGE_LOAD) return;
  reportedCount += 1;

  const err = error instanceof Error ? error : undefined;
  const digest = (error as { digest?: unknown } | null)?.digest;
  const payload = {
    source,
    message: clip(err?.message ?? String(error), CLIENT_ERROR_LIMITS.message),
    name: err ? clip(err.name, CLIENT_ERROR_LIMITS.name) : undefined,
    stack: err?.stack ? clip(err.stack, CLIENT_ERROR_LIMITS.stack) : undefined,
    componentStack: componentStack
      ? clip(componentStack, CLIENT_ERROR_LIMITS.componentStack)
      : undefined,
    digest: typeof digest === 'string' ? clip(digest, CLIENT_ERROR_LIMITS.digest) : undefined,
    // クエリとハッシュにはトークンなどが載りうるので送らない
    path: clip(window.location.pathname, CLIENT_ERROR_LIMITS.path),
  };

  navigator.sendBeacon(
    CLIENT_ERROR_ENDPOINT,
    new Blob([JSON.stringify(payload)], { type: 'application/json' }),
  );
}

/** テスト用。ページ単位の送信数を数え直す */
export function resetClientErrorCountForTest(): void {
  reportedCount = 0;
}
