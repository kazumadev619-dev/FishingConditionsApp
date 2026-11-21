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

/** 項目ごとの長さの上限（UTF-16 の文字数。zod の max と同じ数え方） */
const ITEM_LIMITS = {
  message: 500,
  name: 100,
  stack: 4000,
  componentStack: 2000,
  digest: 100,
  path: 200,
} as const;

/**
 * 本文の上限（バイト）。項目の上限をすべて満たした本文が、必ず通る値にする（#247）。
 *
 * 1文字が JSON になって最も長くなるのは制御文字で、`\u0001` の6バイト（日本語は3バイト、
 * 引用符と改行は2バイト）。全項目をその最悪で埋めた長さに、キー名・引用符・括弧の余裕
 * 1024 バイトを足す。これより大きい本文は、項目の上限を守っても作れないので拒否してよい。
 */
const WORST_BYTES_PER_CHAR = 6;
const BODY_OVERHEAD_BYTES = 1024;
const itemChars = Object.values(ITEM_LIMITS).reduce((sum, n) => sum + n, 0);

/** 受け口が受け付ける長さ。ログを溢れさせないため、受け口は超えた分を切らず拒否する */
export const CLIENT_ERROR_LIMITS = {
  ...ITEM_LIMITS,
  bodyBytes: itemChars * WORST_BYTES_PER_CHAR + BODY_OVERHEAD_BYTES,
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
