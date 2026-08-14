import { auth } from '@/auth/edge';

/**
 * Next.js 16 Proxy (旧middleware)
 * Node.js Runtimeで動作（runtime設定は不可）
 * auth/edge.tsからauth()をインポート（シンプルかつ明示的）
 */
export default auth;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (Auth.js routes)
     * - healthz (liveness/readiness probe)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     *
     * 除外は全て `(?:/|$)` でパス境界に固定する。固定しないと /healthz-debug や
     * /_next/static-evil のような別ルートまで proxy を素通りする。
     * メタデータ系の `.` も正規表現のワイルドカードにならないようエスケープする
     * （素の `.` だと /faviconZico が favicon.ico として除外される）。
     */
    '/((?!api/auth(?:/|$)|healthz(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico(?:/|$)|sitemap\\.xml(?:/|$)|robots\\.txt(?:/|$)).*)',
  ],
};
