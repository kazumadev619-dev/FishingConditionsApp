import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth/edge';
import { buildCsp } from '@/lib/csp.mjs';

/**
 * Next.js 16 Proxy (旧middleware)
 * Node.js Runtimeで動作（runtime設定は不可）
 *
 * 1. auth()（src/auth/edge.ts）で認証判定する
 * 2. 通すリクエストには、nonce 入りの CSP をリクエストとレスポンスの両方に付ける（#147）。
 *    Next.js はリクエストヘッダの CSP から nonce を拾い、自前の <script> に付ける
 *
 * `auth((req) => ...)` のラッパー形式は使わない。next-auth はラッパーを渡されると、
 * authorized() が false を返してもログインへのリダイレクトをせずラッパーを呼ぶ
 * （node_modules/next-auth/lib/index.js の handleAuth）。保護が外れる。
 */
export default async function proxy(request: NextRequest): Promise<Response> {
  // next-auth の型は `export { auth as default }` 形式（Request を直接渡す呼び方）の
  // オーバーロードを公開していないが、実装は Request を受けて Response を返す
  // （同 index.js の `args[0] instanceof Request` の分岐）
  const authResponse = await (auth as unknown as (req: NextRequest) => Promise<Response>)(request);

  // 401 やリダイレクト。HTML を返さないので nonce は要らない
  if (authResponse.headers.get('x-middleware-next') !== '1') return authResponse;

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({ nonce });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // auth() が後続へ進めるときに付けるのは x-middleware-next とセッション更新の
  // Set-Cookie だけ。Set-Cookie を落とすとセッションの延長が効かなくなる
  for (const cookie of authResponse.headers.getSetCookie()) {
    response.headers.append('Set-Cookie', cookie);
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (Auth.js routes)
     * - healthz (liveness probe)
     * - readyz (readiness probe)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     *
     * 除外は全て `(?:/|$)` でパス境界に固定する。固定しないと /healthz-debug や
     * /_next/static-evil のような別ルートまで proxy を素通りする。
     * メタデータ系の `.` も正規表現のワイルドカードにならないようエスケープする
     * （素の `.` だと /faviconZico が favicon.ico として除外される）。
     */
    '/((?!api/auth(?:/|$)|healthz(?:/|$)|readyz(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico(?:/|$)|sitemap\\.xml(?:/|$)|robots\\.txt(?:/|$)).*)',
  ],
};
